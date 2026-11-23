// Lifecycle state is separate from SDK adapters so recovery can be tested without a live meeting.
export function createRtmsLifecycle({
  createClient,
  onBegin = () => {},
  onState = () => {},
  onTranscript = () => {},
  onParticipants = () => {},
  onFinalize = () => {},
  now = Date.now,
  timer = setTimeout,
  cancel = clearTimeout,
  random = Math.random,
  recoveryMs = 55000,
}) {
  const sessions = new Map();
  const emit = (s, status) => {
    s.status = status;
    onState(s.meetingId, status, s);
  };
  function release(s) {
    const client = s.client;
    s.client = null;
    try {
      client?.leave();
    } catch {
      /* Finalization must not depend on a successful leave. */
    }
  }
  function finish(s, reason) {
    if (sessions.get(s.meetingId) !== s || s.stopped) return;
    s.stopped = true;
    sessions.delete(s.meetingId);
    cancel(s.retryTimer);
    cancel(s.deadlineTimer);
    release(s);
    emit(s, reason === "recovery-exhausted" ? "error" : "stopped");
    onFinalize(s.meetingId, reason);
  }
  function window(s) {
    if (s.deadline) return;
    s.deadline = now() + recoveryMs;
    s.deadlineTimer = timer(() => finish(s, "recovery-exhausted"), recoveryMs);
    s.deadlineTimer?.unref?.();
  }
  function recover(s) {
    if (s.stopped || sessions.get(s.meetingId) !== s) return;
    window(s);
    release(s);
    emit(s, "reconnecting");
    if (s.retryTimer) return;
    const delay =
      Math.min(500 * 2 ** s.attempts++, 8000) + Math.floor(random() * 200);
    if (s.attempts > 8 || now() + delay >= s.deadline)
      return finish(s, "recovery-exhausted");
    s.retryTimer = timer(() => {
      s.retryTimer = null;
      connect(s);
    }, delay);
    s.retryTimer?.unref?.();
  }
  function connect(s) {
    if (s.stopped) return;
    const client = createClient();
    s.client = client;
    const current = () =>
      sessions.get(s.meetingId) === s && s.client === client && !s.stopped;
    client.onJoinConfirm((reason) => {
      if (!current()) return;
      if (reason !== 0) return recover(s);
      cancel(s.retryTimer);
      cancel(s.deadlineTimer);
      s.retryTimer = null;
      s.deadlineTimer = null;
      s.deadline = 0;
      s.attempts = 0;
      try {
        // The sample subscribes only to transcript data.
        if (typeof client.enableAudio === "function") client.enableAudio(false);
        if (typeof client.enableVideo === "function") client.enableVideo(false);
        client.enableTranscript(true);
      } catch {
        return recover(s);
      }
      emit(s, "active");
    });
    client.onLeave(() => {
      if (current()) recover(s);
    });
    client.onMediaConnectionInterrupted?.(() => {
      if (current()) recover(s);
    });
    client.onTranscriptData((...args) => {
      if (current()) onTranscript(s.meetingId, ...args);
    });
    client.onParticipantEvent((...args) => {
      if (current()) onParticipants(s.meetingId, ...args);
    });
    client.onSessionUpdate((op) => {
      if (current())
        emit(s, op === 3 ? "paused" : op === 2 ? "stopping" : "active");
    });
    window(s);
    try {
      if (
        !client.join({
          meeting_uuid: s.meetingId,
          rtms_stream_id: s.streamId,
          server_urls: s.urls,
          client: process.env.ZOOM_CLIENT_ID,
          secret: process.env.ZOOM_CLIENT_SECRET,
          pollInterval: 500,
        })
      )
        recover(s);
    } catch {
      recover(s);
    }
  }
  function start(meetingId, streamId, urls) {
    const existing = sessions.get(meetingId);
    if (existing) {
      if (existing.streamId !== streamId || existing.urls !== urls) {
        existing.streamId = streamId;
        existing.urls = urls;
        recover(existing);
      }
      return;
    }
    const s = {
      meetingId,
      streamId,
      urls,
      stopped: false,
      attempts: 0,
      deadline: 0,
      retryTimer: null,
      deadlineTimer: null,
      client: null,
    };
    sessions.set(meetingId, s);
    onBegin(meetingId, streamId, urls);
    emit(s, "connecting");
    connect(s);
  }
  function interrupt(meetingId, streamId, urls) {
    const s = sessions.get(meetingId);
    if (!s) {
      if (streamId && urls) start(meetingId, streamId, urls);
      return;
    }
    if (streamId && s.streamId !== streamId) return; // Ignore late events for a replaced stream.
    if (urls) s.urls = urls;
    recover(s);
  }
  function stop(meetingId, streamId, reason) {
    const s = sessions.get(meetingId);
    if (!s || (streamId && s.streamId !== streamId)) return;
    const code = Number(reason);
    if ((code >= 10 && code <= 19) || code === 24) return recover(s);
    finish(s, code === 8 ? "revoked" : "stopped");
  }
  return {
    start,
    interrupt,
    stop,
    active: (meetingId) => sessions.has(meetingId),
  };
}
