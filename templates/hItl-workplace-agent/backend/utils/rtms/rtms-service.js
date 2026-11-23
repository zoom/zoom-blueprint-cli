import rtms from "@zoom/rtms";
import { createRtmsLifecycle } from "./rtms-lifecycle.js";
import { broadcastToMeeting } from "./websocket-service.js";
import {
  createSession,
  getSession,
  updateSessionStatus,
  removeSession,
  upsertParticipant,
} from "./meeting-session-store.js";
import { clearTranscript } from "./transcript-store.js";
import taskStore from "../store/task-store.js";
import { handleTranscriptSegment } from "./transcript-handler.js";
import { runPostMeetingAnalysis } from "./post-meeting-ai.js";
import { logger } from "../logger.js";
const log = logger("rtms");
const lifecycle = createRtmsLifecycle({
  createClient: () => new rtms.Client(),
  onBegin(meetingId, streamId, urls) {
    createSession(meetingId, streamId, urls);
    if (!taskStore.getMeetingContext(meetingId))
      taskStore.upsertMeetingContext(meetingId, {
        id: meetingId,
        zoomMeetingUuid: meetingId,
        title: "Live meeting",
        date: new Date().toISOString(),
        participants: [],
        summary: "",
        decisions: [],
        highlights: [],
        risks: [],
      });
    taskStore.logActivity({
      type: "meeting.started",
      meetingId,
      actor: "system",
      payload: { rtmsStreamId: streamId },
    });
  },
  onState(meetingId, status, state) {
    const session = getSession(meetingId);
    if (session) {
      session.rtmsStreamId = state.streamId;
      session.serverUrls = state.urls;
    }
    updateSessionStatus(meetingId, status);
    broadcastToMeeting(meetingId, {
      type: "meeting.status",
      meetingId,
      status,
    });
    log.info("session state", { meeting: meetingId, status });
  },
  onTranscript(meetingId, buffer, _size, timestamp, metadata) {
    handleTranscriptSegment(meetingId, {
      userId: metadata?.userId,
      userName: metadata?.userName,
      text: buffer.toString("utf8"),
      seqNo: timestamp,
      tStartMs: timestamp,
      tEndMs: null,
      confidence: null,
    });
  },
  onParticipants(meetingId, eventType, timestamp, participants) {
    for (const p of participants ?? [])
      upsertParticipant(meetingId, { userId: p.userId, userName: p.userName });
    broadcastToMeeting(meetingId, {
      type: "participant.event",
      meetingId,
      eventType,
      timestamp,
      participants: participants ?? [],
    });
  },
  onFinalize(meetingId, reason) {
    if (reason === "revoked") {
      clearTranscript(meetingId);
      taskStore.clearTranscript(meetingId);
    } else
      runPostMeetingAnalysis(meetingId).catch(() =>
        log.error("post-meeting analysis failed", { meeting: meetingId }),
      );
    const finalSession = getSession(meetingId);
    const timer = setTimeout(() => {
      if (getSession(meetingId) === finalSession) removeSession(meetingId);
    }, 60000);
    timer.unref?.();
  },
});
export const startRtmsSession = lifecycle.start;
export const interruptRtmsSession = lifecycle.interrupt;
export const stopRtmsSession = lifecycle.stop;
export const isSessionActive = lifecycle.active;
export { runPostMeetingAnalysis };
