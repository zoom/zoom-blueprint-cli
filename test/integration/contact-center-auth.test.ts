import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authConfig, beginAuthorization, completeAuthorization } from '../../templates/zcc-nextjs-sample/lib/zoom-auth';

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://contact.ngrok.app');
  vi.stubEnv('ZOOM_REDIRECT_URI', 'https://contact.ngrok.app/auth/callback');
  vi.stubEnv('ZOOM_CLIENT_ID', 'app-client');
  vi.stubEnv('ZOOM_CLIENT_SECRET', 'app-secret');
  vi.stubEnv('ZOOM_API_BASE_URL', 'https://api.zoom.us/v2');
  vi.stubEnv('ZOOM_OAUTH_BASE_URL', 'https://zoom.us');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('starts browser OAuth with the app credentials, callback, and fresh random state', () => {
  const start = beginAuthorization();
  expect(start.secure).toBe(true);
  expect(start.url.origin).toBe('https://zoom.us');
  expect(start.url.searchParams.get('redirect_uri')).toBe('https://contact.ngrok.app/auth/callback');
  expect(start.url.searchParams.get('client_id')).toBe('app-client');
  expect(start.url.searchParams.get('state')).toBe(start.state);
  expect(beginAuthorization().state).not.toBe(start.state);
  expect(start.url.href).not.toContain('app-secret');
});

it('exchanges a valid callback and returns a Zoom launch link using the user token', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'private-user-token' }))
    .mockResolvedValueOnce(Response.json({ deeplink: 'https://zoom.us/launch/app/test' }));
  vi.stubGlobal('fetch', fetch);
  expect(await completeAuthorization('code', 'state', 'state')).toBe('https://zoom.us/launch/app/test');
  expect(String(fetch.mock.calls[0][0])).toBe('https://zoom.us/oauth/token');
  expect(fetch.mock.calls[0][1].body.get('redirect_uri')).toBe('https://contact.ngrok.app/auth/callback');
  expect(fetch.mock.calls[1][0]).toBe('https://api.zoom.us/v2/zoomapp/deeplink');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer private-user-token');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ type: 1, action: 'contact-center' });
});

it.each([['', 'state'], ['mismatch', 'state'], ['state', '']])('rejects an invalid state before any API request', async (actual, expected) => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(completeAuthorization('code', actual, expected)).rejects.toThrow('state');
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects external launch URLs and reports API failures without raw provider data', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'private-user-token' }))
    .mockResolvedValueOnce(Response.json({ deeplink: 'https://attacker.example/launch' }));
  vi.stubGlobal('fetch', fetch);
  await expect(completeAuthorization('code', 'state', 'state')).rejects.toThrow('unexpected launch URL');
  fetch.mockReset().mockResolvedValueOnce(new Response('private provider body', { status: 401 }));
  await expect(completeAuthorization('code', 'state', 'state')).rejects.toThrow('could not complete authorization');
});

it('rejects missing credentials and an unsynchronized callback origin', () => {
  vi.stubEnv('ZOOM_REDIRECT_URI', 'https://old.ngrok.app/auth/callback');
  expect(() => authConfig()).toThrow('SITE_URL origin');
  vi.stubEnv('ZOOM_CLIENT_ID', '');
  expect(() => authConfig()).toThrow('ZOOM_CLIENT_ID');
});
