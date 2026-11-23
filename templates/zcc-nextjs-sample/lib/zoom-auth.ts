import { randomBytes, timingSafeEqual } from 'node:crypto';

export class ZoomAuthError extends Error {}

export const STATE_COOKIE = 'zcc_oauth_state';
export const STATE_COOKIE_PATH = '/auth';

export function authConfig() {
  const site = new URL(process.env.SITE_URL || 'http://localhost:3000');
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret || /^your[_-]/i.test(clientId) || /^your[_-]/i.test(clientSecret)) {
    throw new ZoomAuthError('Set the app’s ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in .env, then restart.');
  }
  const redirectUri = process.env.ZOOM_REDIRECT_URI || new URL('/auth/callback', site).href;
  if (new URL(redirectUri).origin !== site.origin) throw new ZoomAuthError('ZOOM_REDIRECT_URI must use the SITE_URL origin.');
  return {
    clientId, clientSecret, redirectUri,
    secure: site.protocol === 'https:',
    oauthBase: process.env.ZOOM_OAUTH_BASE_URL || 'https://zoom.us',
    apiBase: process.env.ZOOM_API_BASE_URL || 'https://api.zoom.us/v2',
  };
}

export function beginAuthorization() {
  const config = authConfig();
  const state = randomBytes(32).toString('hex');
  const url = new URL('/oauth/authorize', config.oauthBase);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, state,
  }).toString();
  return { url, state, secure: config.secure };
}

export async function completeAuthorization(code: string, state: string, expectedState: string) {
  const actual = Buffer.from(state);
  const expected = Buffer.from(expectedState);
  if (!code || !expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ZoomAuthError('Authorization expired or state did not match. Return to the app and try again.');
  }
  const config = authConfig();
  const tokenResponse = await fetch(new URL('/oauth/token', config.oauthBase), {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(config.clientId + ':' + config.clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
    cache: 'no-store',
  });
  if (!tokenResponse.ok) throw new ZoomAuthError('Zoom could not complete authorization. Check app credentials and the registered redirect URL, then try again.');
  const tokens = await tokenResponse.json();
  if (!tokens.access_token) throw new ZoomAuthError('Zoom returned no access token. Try authorizing again.');

  const response = await fetch(config.apiBase + '/zoomapp/deeplink', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 1, action: 'contact-center' }),
    cache: 'no-store',
  });
  if (!response.ok) throw new ZoomAuthError('Authorized, but Zoom could not generate the launch link. Confirm the Zoom Apps SDK is enabled, the zoomapp:inmeeting scope is configured, and account permissions allow launch.');
  const result = await response.json();
  const url = new URL(result.deeplink);
  const allowed = ['zoom.us', 'zoomgov.com'];
  if (url.protocol !== 'https:' || !allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    throw new ZoomAuthError('Zoom returned an unexpected launch URL. Try again.');
  }
  return url.href;
}
