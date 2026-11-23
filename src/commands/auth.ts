import { getEnv } from '../config/env.js';
import { readDotenvFile } from '../config/dotenv.js';
import { authorizationUrl, createPkce, getPublicAccessToken, listenForAuthorization, openBrowser, requestPublicToken, tokenSession } from '../auth/pkce.js';
import { readSession, removeSession, saveSession, withSessionLock } from '../auth/store.js';
import { getAppManifest, validateAppManifest } from '../marketplace/client.js';
import { log } from '../util/logger.js';

export interface LoginOptions { envFile?: string; env?: string; port?: string; browser?: boolean; }
export interface LoginDeps {
  candidates?: string[];
  listen?: typeof listenForAuthorization;
  open?: typeof openBrowser;
  token?: typeof requestPublicToken;
}

export async function login(opts: LoginOptions, deps: LoginDeps = {}): Promise<number> {
  const env = getEnv(opts.env);
  const clientId = process.env.ZOOM_PUBLIC_CLIENT_ID?.trim() ||
    (deps.candidates ?? []).map(file => readDotenvFile(file)?.ZOOM_PUBLIC_CLIENT_ID?.trim()).find(Boolean);
  if (!clientId || /\s/.test(clientId) || /^your[_-]/i.test(clientId)) throw new Error(
    'Set ZOOM_PUBLIC_CLIENT_ID in the CLI .env file, then run zoom login. For another location, use zoom login --env-file <path>. See docs/create-cli-app.md for public-client setup.',
  );
  const pkce = createPkce();
  const callback = await (deps.listen ?? listenForAuthorization)(pkce.state, Number(opts.port ?? 0));
  try {
    const url = authorizationUrl(env, clientId, callback.redirectUri, pkce);
    log.heading('Sign in to Zoom');
    log.plain('  Approve the CLI’s Marketplace permissions in your browser.');
    log.plain(`  Callback: ${callback.redirectUri}`);
    if (opts.browser !== false) {
      try { await (deps.open ?? openBrowser)(url); }
      catch { log.warn('Could not open your browser. Open the authorization link below.'); log.plain(`\n  ${url}\n`); }
    } else log.plain(`\n  ${url}\n`);
    const code = await callback.code;
    const data = await (deps.token ?? requestPublicToken)(env, { grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: callback.redirectUri, code, code_verifier: pkce.verifier });
    await withSessionLock(env.name, () => saveSession(tokenSession(env, clientId, data)));
    log.success(`Signed in to Zoom (${env.name}).`);
    log.plain('  Marketplace access has not been verified.');
    log.plain('  Run zoom auth check --app-id <existing-app-id> to check read and manifest-validation access.');
    return 0;
  } finally { await callback.close(); }
}

export async function logout(opts: { env?: string }): Promise<number> {
  const env = getEnv(opts.env);
  let failed = false;
  await withSessionLock(env.name, async () => {
    try {
      const session = readSession(env.name);
      if (session) {
        const response = await fetch(`${env.zoomApiBase}/oauth/revoke`, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: session.clientId, token: session.accessToken }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) failed = true;
      }
    } catch { failed = true; }
    finally { await removeSession(env.name); }
  });
  log.success(`Local Zoom login removed (${env.name}).`);
  if (failed) { log.warn('Zoom token revocation was not confirmed. Remove the CLI authorization in Marketplace if needed.'); return 1; }
  return 0;
}

export async function authStatus(opts: { env?: string }): Promise<number> {
  const env = getEnv(opts.env);
  const session = readSession(env.name);
  if (!session) { log.plain(`Not signed in to Zoom (${env.name}). Run zoom login.`); return 1; }
  log.success(`Saved public OAuth login (${env.name}).`);
  log.plain(session.expiresAt <= Date.now() + 60000 ? '  Access token needs refresh; the next Marketplace operation will refresh it.' : '  Access token has not expired.');
  log.plain('  Local status only; Marketplace permissions have not been checked.');
  return 0;
}

export async function authCheck(opts: { env?: string; appId: string }): Promise<number> {
  const env = getEnv(opts.env);
  const token = await getPublicAccessToken(env.zoomApiBase);
  const base = env.name === 'prod' ? 'https://api.zoom.us' : env.zoomApiBase;
  const manifest = await getAppManifest({ zoomApiBase: base, accessToken: token, appId: opts.appId });
  log.success('Marketplace manifest read succeeded with public PKCE OAuth.');
  const validation = await validateAppManifest({ zoomApiBase: base, accessToken: token, manifest, appId: opts.appId });
  if (!validation.ok) {
    log.warn('Marketplace validation API accepted the request but reported manifest issues.');
    // Validation messages use the existing secret-safe error formatter at the command boundary.
    log.plain('  Run zoom app validate from the linked project to inspect the manifest.');
  } else log.success('Marketplace manifest validation succeeded with public PKCE OAuth.');
  const scopes = readSession(env.name)?.scopes ?? [];
  const write = scopes.some(scope => ['marketplace:write:app', 'marketplace:write:app:admin'].includes(scope));
  log.plain(`  Write scope: ${write ? 'present in the token grant' : 'not confirmed in the token grant'}.`);
  log.plain('  Create, update, and delete were not exercised; no app was changed.');
  return validation.ok && write ? 0 : 1;
}
