export class OperatorAccessError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
    this.publicMessage = message;
  }
}
// This in-memory sample has one operator, not a multi-tenant resource database.
// Zoom verifies the identity; browsers cannot select an actor through headers or JSON.
export function createOperatorAccess({
  fetchImpl = fetch,
  now = Date.now,
  configuredUserId = process.env.ZOOM_OPERATOR_USER_ID,
} = {}) {
  let operatorId = configuredUserId || null;
  let accountId = null;
  const isOperatorRequest = (req) =>
    Boolean(
      req.session?.zoomTokens?.access_token &&
      req.session?.operator?.id === operatorId &&
      (!accountId || req.session.operator.accountId === accountId) &&
      req.session.operatorExpiresAt > now(),
    );

  async function authorizeSession(req, tokens) {
    if (typeof tokens?.access_token !== "string" || !tokens.access_token)
      throw new Error("Zoom did not return an access token.");
    if (process.env.NODE_ENV === "production" && !configuredUserId)
      throw new OperatorAccessError(
        "Set ZOOM_OPERATOR_USER_ID before using this sample in production.",
      );
    const base = (
      process.env.ZOOM_API_BASE_URL || "https://api.zoom.us/v2"
    ).replace(/\/$/, "");
    const response = await fetchImpl(`${base}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        "Could not verify the Zoom user. Check the user:read:user scope.",
      );
    const profile = await response.json();
    if (
      typeof profile.id !== "string" ||
      !profile.id ||
      typeof profile.account_id !== "string" ||
      !profile.account_id
    )
      throw new Error("Zoom did not return a verified user and account.");
    const expectedAccount = process.env.ZOOM_ACCOUNT_ID;
    if (
      expectedAccount &&
      !/^(your[_-]|placeholder|changeme)/i.test(expectedAccount) &&
      expectedAccount !== profile.account_id
    )
      throw new OperatorAccessError(
        "This Zoom account is not configured for this sample.",
      );
    if (operatorId && operatorId !== profile.id)
      throw new OperatorAccessError(
        "This sample belongs to another operator. Use the configured Zoom account.",
      );
    if (accountId && accountId !== profile.account_id)
      throw new OperatorAccessError(
        "This sample belongs to another Zoom account.",
      );
    const expiresIn = Number(tokens.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0)
      throw new Error("Zoom returned an invalid token lifetime.");
    operatorId = profile.id;
    accountId = profile.account_id;
    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.zoomTokens = tokens;
    req.session.operator = { id: operatorId, accountId };
    req.session.operatorExpiresAt = now() + expiresIn * 1000;
  }
  function requireOperator(req, res, next) {
    if (!isOperatorRequest(req))
      return res
        .status(401)
        .json({
          success: false,
          authRequired: true,
          authStartUrl: "/auth/login",
          error: "Sign in with the sample operator’s Zoom account to continue.",
        });
    req.operator = req.session.operator;
    return next();
  }
  return { authorizeSession, requireOperator, isOperatorRequest };
}

export function isTrustedOrigin(origin) {
  if (!origin) return false;
  const origins = [
    process.env.PUBLIC_BASE_URL,
    process.env.FRONTEND_PUBLIC_URL,
    process.env.FRONTEND_ORIGIN,
  ];
  if (process.env.NODE_ENV !== "production")
    origins.push(
      `http://localhost:${process.env.FRONTEND_PORT || 3000}`,
      `http://127.0.0.1:${process.env.FRONTEND_PORT || 3000}`,
    );
  return origins.some((value) => {
    try {
      return new URL(value).origin === origin;
    } catch {
      return false;
    }
  });
}
export function sameOriginWrite(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (
    req.get("X-Zoom-Requested-With") !== "zoom-blueprint" ||
    !isTrustedOrigin(req.get("Origin"))
  )
    return res
      .status(403)
      .json({
        success: false,
        error: "Use the sample’s authorized frontend for this request.",
      });
  return next();
}
export const { authorizeSession, requireOperator, isOperatorRequest } =
  createOperatorAccess();
