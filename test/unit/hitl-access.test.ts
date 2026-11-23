import { it, expect, vi, afterEach } from "vitest";
import {
  createOperatorAccess,
  sameOriginWrite,
  isTrustedOrigin,
} from "../../templates/hitl-workplace-agent/backend/middleware/access.js";
import { taskUpdates } from "../../templates/hitl-workplace-agent/backend/utils/task-input.js";
import { actorFrom } from "../../templates/hitl-workplace-agent/backend/routes/api/helpers.js";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function request() {
  const req: any = { session: {} };
  req.session.regenerate = (done: Function) => {
    req.session = {};
    done();
  };
  return req;
}
function response() {
  const res: any = { statusCode: 200, body: null };
  res.status = (s: number) => ((res.statusCode = s), res);
  res.json = (body: any) => ((res.body = body), res);
  return res;
}
function policy() {
  vi.stubEnv("ZOOM_ACCOUNT_ID", "");
  vi.stubEnv("NODE_ENV", "development");
  let profile = { id: "operator-1", account_id: "account-1" };
  const fetchImpl = vi.fn(async () => Response.json(profile));
  return {
    access: createOperatorAccess({ fetchImpl, configuredUserId: undefined }),
    fetchImpl,
    setProfile: (p: typeof profile) => (profile = p),
  };
}
const tokens = {
  access_token: "private-access",
  refresh_token: "private-refresh",
  expires_in: 3600,
};
it("denies anonymous API requests with actionable JSON and no token values", () => {
  const p = policy(),
    res = response(),
    next = vi.fn();
  p.access.requireOperator({ session: {} }, res, next);
  expect(res.statusCode).toBe(401);
  expect(res.body.authStartUrl).toBe("/auth/login");
  expect(next).not.toHaveBeenCalled();
  expect(JSON.stringify(res.body)).not.toContain("private-access");
});
it("verifies users/me, regenerates the session, and admits only the pinned operator", async () => {
  const p = policy(),
    req = request();
  await p.access.authorizeSession(req, tokens);
  expect(p.fetchImpl).toHaveBeenCalledOnce();
  expect(p.access.isOperatorRequest(req)).toBe(true);
  expect(req.session.operator.id).toBe("operator-1");
  const res = response(),
    next = vi.fn();
  p.access.requireOperator(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  expect(
    actorFrom({
      ...req,
      body: { actor: "attacker" },
      headers: { "x-user-id": "attacker" },
    }),
  ).toBe("operator-1");
  p.setProfile({ id: "operator-2", account_id: "account-1" });
  await expect(p.access.authorizeSession(request(), tokens)).rejects.toThrow(
    /another operator/,
  );
});
it("rejects expired sessions and accounts that do not match explicit configuration", async () => {
  const p = policy(),
    req = request();
  await p.access.authorizeSession(req, tokens);
  req.session.operatorExpiresAt = Date.now() - 1;
  expect(p.access.isOperatorRequest(req)).toBe(false);
  vi.stubEnv("ZOOM_ACCOUNT_ID", "other-account");
  await expect(p.access.authorizeSession(request(), tokens)).rejects.toThrow(
    /not configured/,
  );
});
it("honors an explicit operator ID and never trusts body or header identities", async () => {
  vi.stubEnv("ZOOM_ACCOUNT_ID", "");
  const p = createOperatorAccess({
    configuredUserId: "configured-user",
    fetchImpl: async () =>
      Response.json({ id: "someone-else", account_id: "account" }),
  });
  await expect(p.authorizeSession(request(), tokens)).rejects.toThrow(
    /another operator/,
  );
  const req = {
    session: {
      zoomTokens: tokens,
      operator: { id: "someone-else" },
      operatorExpiresAt: Date.now() + 10000,
    },
  };
  expect(p.isOperatorRequest(req)).toBe(false);
});
it("requires a configured operator for production and fails closed on invalid Zoom identities", async () => {
  const p = policy();
  vi.stubEnv("NODE_ENV", "production");
  await expect(p.access.authorizeSession(request(), tokens)).rejects.toThrow(
    /ZOOM_OPERATOR_USER_ID/,
  );
  vi.stubEnv("NODE_ENV", "development");
  p.setProfile({ id: "", account_id: "" });
  await expect(p.access.authorizeSession(request(), tokens)).rejects.toThrow(
    /verified user/,
  );
});
it.each([
  ["https://evil.example", "zoom-blueprint", 403],
  ["https://app.example", undefined, 403],
  ["https://app.example", "zoom-blueprint", 200],
])("checks CSRF origin %s and request marker", (origin, marker, status) => {
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
  const req = {
      method: "PATCH",
      get: (key: string) => (key === "Origin" ? origin : marker),
    },
    res = response(),
    next = vi.fn();
  sameOriginWrite(req, res, next);
  expect(res.statusCode).toBe(status);
  expect(next).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
});
it("permits safe reads without a mutation marker", () => {
  const next = vi.fn();
  sameOriginWrite({ method: "GET" }, response(), next);
  expect(next).toHaveBeenCalledOnce();
});
it.each([
  { actor: "forged" },
  { id: "replace-id" },
  { meetingInstanceId: "other-meeting" },
  { approvedTaskId: "bypass" },
  { status: "approved" },
  { priority: "Urgent" },
  { owner: {} },
  { title: [] },
  { title: "" },
  { dueDate: "2026-02-30" },
  JSON.parse('{"__proto__":{"polluted":true}}'),
])("rejects invalid or protected task update %j", (body) => {
  expect(() => taskUpdates(body)).toThrow();
  expect(({} as any).polluted).toBeUndefined();
});
it("whitelists editable task fields and preserves server-owned identity", () => {
  expect(
    taskUpdates({
      title: "Reviewed task",
      owner: null,
      priority: "High",
      dueDate: "2026-12-01",
      status: "in_progress",
    }),
  ).toEqual({
    title: "Reviewed task",
    owner: null,
    priority: "High",
    dueDate: "2026-12-01",
    status: "in_progress",
  });
  expect(() =>
    taskUpdates({ status: "completed" }, { allowStatus: false }),
  ).toThrow();
  expect(taskUpdates({}, { allowEmpty: true })).toEqual({});
});

it("does not implicitly allow development origins in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example");
  vi.stubEnv("FRONTEND_ORIGIN", "https://app.example");
  vi.stubEnv("FRONTEND_PUBLIC_URL", "");
  expect(isTrustedOrigin("http://localhost:3000")).toBe(false);
  expect(isTrustedOrigin("https://app.example")).toBe(true);
});
