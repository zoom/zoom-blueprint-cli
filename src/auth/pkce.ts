import { renderAuthorizationPage, type AuthorizationPageState } from './redirect-page.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { getEnv, type ZoomEnv } from '../config/env.js';
import { readSession, saveSession, withSessionLock, type OAuthSession } from './store.js';

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url') };
}

export function authorizationUrl(env: ZoomEnv, clientId: string, redirectUri: string, pkce: ReturnType<typeof createPkce>): string {
  const url = new URL('/oauth/authorize', env.zoomApiBase);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state }).toString();
  return url.href;
}

export async function requestPublicToken(env: ZoomEnv, fields: Record<string, string>, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(`${env.zoomApiBase}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields), signal: AbortSignal.timeout(20000),
  });
  // Never echo a token response: even failed responses can contain sensitive fields.
  if (!response.ok) throw new Error(`Zoom public OAuth failed (HTTP ${response.status}). Check public-client registration and permissions, then run zoom login again.`);
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; }
  catch { throw new Error('Zoom returned an invalid OAuth response. Run zoom login again.'); }
  if (!data || typeof data !== 'object') throw new Error('Zoom returned an incomplete OAuth token response. Run zoom login again.');
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token ||
      !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
    throw new Error('Zoom returned an incomplete OAuth token response. Run zoom login again.');
  }
  return data;
}

export function tokenSession(env: ZoomEnv, clientId: string, data: Record<string, unknown>, previousScopes: string[] = []): OAuthSession {
  return { version: 1, environment: env.name as 'prod' | 'dev', clientId,
    accessToken: data.access_token as string, refreshToken: data.refresh_token as string,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
    scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previousScopes };
}

const refreshes = new Map<string, Promise<string>>();
export async function getPublicAccessToken(zoomApiBase: string): Promise<string> {
  const name = zoomApiBase === getEnv('prod').zoomApiBase ? 'prod' : undefined;
  if (!name) throw new Error('Public OAuth cannot be used with an unknown Zoom host.');
  const existing = refreshes.get(name);
  if (existing) return existing;
  const session = readSession(name);
  if (!session) throw new Error(`No Zoom login for ${name}. Run zoom login --env ${name}.`);
  if (session.expiresAt > Date.now() + 60000) return session.accessToken;
  const refresh = withSessionLock(name, async () => {
    const current = readSession(name);
    if (!current) throw new Error(`No Zoom login for ${name}. Run zoom login --env ${name}.`);
    if (current.expiresAt > Date.now() + 60000) return current.accessToken;
    const data = await requestPublicToken(getEnv(name), { grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refreshToken });
    const next = tokenSession(getEnv(name), current.clientId, data, current.scopes);
    await saveSession(next);
    return next.accessToken;
  });
  refreshes.set(name, refresh);
  try { return await refresh; } finally { refreshes.delete(name); }
}

/** A single-use, loopback-only callback listener; wrong-state requests cannot complete login. */
export async function listenForAuthorization(state: string, port = 0, timeoutMs = 180000): Promise<{
  redirectUri: string; code: Promise<string>; close(): Promise<void>;
}> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('OAuth port must be between 0 and 65535.');
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Callers attach their consumer after listen completes; prevent an early timeout rejection warning.
  void code.catch(() => {});
  let finished = false;
  const nonce = randomBytes(18).toString('base64');
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const page = (state: AuthorizationPageState) => renderAuthorizationPage(state, nonce);
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return; }
    const supplied = Buffer.from(url.searchParams.get('state') || '');
    const expected = Buffer.from(state);
    if (finished || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(400); res.end(page('invalid')); return;
    }
    const value = url.searchParams.get('code');
    if (url.searchParams.has('error')) {
      finished = true; res.writeHead(400); res.end(page('declined'));
      rejectCode(new Error('Zoom authorization was declined. Run zoom login to try again.')); return;
    }
    if (!value) { res.writeHead(400); res.end(page('invalid')); return; }
    finished = true; res.end(page('received')); resolveCode(value);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
  const cancel = () => rejectCode(Object.assign(new Error('Cancelled.'), { name: 'ExitPromptError' }));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const timer = setTimeout(() => rejectCode(new Error('Zoom login timed out. Run zoom login again.')), timeoutMs);
  return { redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`, code,
    close: async () => {
      clearTimeout(timer); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } };
}

export async function openBrowser(url: string): Promise<void> {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] :
    process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Could not open the browser.')));
  });
}
