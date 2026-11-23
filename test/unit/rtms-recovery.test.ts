import { it, expect, vi, afterEach } from "vitest";
import { createRtmsLifecycle } from "../../templates/hitl-workplace-agent/backend/utils/rtms/rtms-lifecycle.js";
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const clients: any[] = [];
  const onFinalize = vi.fn(),
    onTranscript = vi.fn(),
    onState = vi.fn();
  const lifecycle = createRtmsLifecycle({
    random: () => 0,
    onFinalize,
    onTranscript,
    onState,
    createClient: () => {
      const cb: any = {};
      const c: any = {
        cb,
        join: vi.fn(() => true),
        leave: vi.fn(),
        enableTranscript: vi.fn(),
        enableAudio: vi.fn(),
        enableVideo: vi.fn(),
      };
      for (const name of [
        "JoinConfirm",
        "Leave",
        "MediaConnectionInterrupted",
        "TranscriptData",
        "ParticipantEvent",
        "SessionUpdate",
      ])
        c["on" + name] = (fn: Function) => (cb[name] = fn);
      clients.push(c);
      return c;
    },
  });
  return { lifecycle, clients, onFinalize, onTranscript, onState };
}
it("enables only transcripts and deduplicates an identical start event", () => {
  const f = fixture();
  f.lifecycle.start("meeting", "stream", "server");
  f.clients[0].cb.JoinConfirm(0);
  f.lifecycle.start("meeting", "stream", "server");
  expect(f.clients).toHaveLength(1);
  expect(f.clients[0].enableAudio).toHaveBeenCalledWith(false);
  expect(f.clients[0].enableVideo).toHaveBeenCalledWith(false);
  expect(f.clients[0].enableTranscript).toHaveBeenCalledWith(true);
  expect(f.onFinalize).not.toHaveBeenCalled();
});
it("recovers an interrupted connection without finalizing or accepting stale callbacks", () => {
  const f = fixture();
  f.lifecycle.start("meeting", "stream", "old-server");
  const first = f.clients[0];
  first.cb.JoinConfirm(0);
  f.lifecycle.interrupt("meeting", "stream", "new-server");
  f.lifecycle.interrupt("meeting", "stream", "new-server");
  expect(f.onFinalize).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(f.clients).toHaveLength(2);
  expect(f.clients[1].join.mock.calls[0][0].server_urls).toBe("new-server");
  first.cb.TranscriptData(Buffer.from("stale"));
  expect(f.onTranscript).not.toHaveBeenCalled();
  f.clients[1].cb.JoinConfirm(0);
  vi.advanceTimersByTime(60000);
  expect(f.onFinalize).not.toHaveBeenCalled();
});
it("recovers unexpected SDK departures and media interruptions", () => {
  const f = fixture();
  f.lifecycle.start("m", "s", "server");
  f.clients[0].cb.JoinConfirm(0);
  f.clients[0].cb.Leave(1);
  vi.advanceTimersByTime(500);
  expect(f.clients).toHaveLength(2);
  f.clients[1].cb.JoinConfirm(0);
  f.clients[1].cb.MediaConnectionInterrupted();
  vi.advanceTimersByTime(500);
  expect(f.clients).toHaveLength(3);
  expect(f.onFinalize).not.toHaveBeenCalled();
});
it("finalizes a silent failed join once when the recovery deadline expires", () => {
  const f = fixture();
  f.lifecycle.start("m", "s", "server");
  vi.advanceTimersByTime(55000);
  expect(f.onFinalize).toHaveBeenCalledExactlyOnceWith(
    "m",
    "recovery-exhausted",
  );
  expect(f.lifecycle.active("m")).toBe(false);
});
it("cancels pending retries on an explicit stop and ignores stale stream events", () => {
  const f = fixture();
  f.lifecycle.start("m", "s", "server");
  f.clients[0].cb.JoinConfirm(0);
  f.lifecycle.stop("m", "old-stream");
  expect(f.lifecycle.active("m")).toBe(true);
  f.lifecycle.interrupt("m", "s");
  f.lifecycle.stop("m", "s", 3);
  vi.advanceTimersByTime(60000);
  expect(f.clients).toHaveLength(1);
  expect(f.onFinalize).toHaveBeenCalledExactlyOnceWith("m", "stopped");
  f.clients[0].cb.Leave(1);
  expect(f.onFinalize).toHaveBeenCalledTimes(1);
});
it("restarts retryable stop reasons but treats revoked streams as terminal", () => {
  const f = fixture();
  f.lifecycle.start("m", "s", "server");
  f.clients[0].cb.JoinConfirm(0);
  f.lifecycle.stop("m", "s", 10);
  vi.advanceTimersByTime(500);
  expect(f.clients).toHaveLength(2);
  f.clients[1].cb.JoinConfirm(0);
  f.lifecycle.stop("m", "s", 8);
  expect(f.onFinalize).toHaveBeenCalledExactlyOnceWith("m", "revoked");
});
it("rejoins when failover supplies new server URLs and survives a false join", () => {
  const f = fixture();
  f.lifecycle.start("m", "s", "server");
  f.clients[0].cb.JoinConfirm(0);
  f.lifecycle.start("m", "s", "replacement");
  vi.advanceTimersByTime(500);
  expect(f.clients[1].join.mock.calls[0][0].server_urls).toBe("replacement");
  f.clients[1].cb.JoinConfirm(1);
  vi.advanceTimersByTime(1000);
  expect(f.clients.length).toBeGreaterThan(2);
  expect(f.onFinalize).not.toHaveBeenCalled();
});
