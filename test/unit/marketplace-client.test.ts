import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createZoomMarketplaceApp,
  createAppFromManifest,
} from '../../src/marketplace/client.js';
vi.mock('../../src/auth/pkce.js', () => ({ getPublicAccessToken: vi.fn(async () => 'tok') }));
import { generateGeneralAppManifest } from '../../src/manifest/index.js';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createZoomMarketplaceApp', () => {
  it('POSTs a wrapped manifest and returns identifiers', async () => {
    const fetchMock = mockFetchOnce(201, {
      app_id: 'APP123',
      credentials: { client_id: 'c', client_secret: 's' },
      oauth_authorize_url: 'https://auth',
    });
    vi.stubGlobal('fetch', fetchMock);
    const manifest = generateGeneralAppManifest({ displayName: 'X' });
    const result = await createZoomMarketplaceApp({ zoomApiBase: 'https://zoom.us', accessToken: 't', manifest });
    expect(result.appId).toBe('APP123');
    expect(result.clientSecret).toBe('s');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.manifest.display_information.display_name).toBe('X');
  });

  it('collapses an invalid_manifest error shape into a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(400, {
        ok: false,
        error: 'invalid_manifest',
        errors: [{ setting: 'display_name', message: 'too long' }],
      }),
    );
    const manifest = generateGeneralAppManifest({ displayName: 'X' });
    await expect(
      createZoomMarketplaceApp({ zoomApiBase: 'https://zoom.us', accessToken: 't', manifest }),
    ).rejects.toThrow(/invalid_manifest.*display_name: too long/);
  });

  it('throws when the response omits app_id', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(200, {}));
    const manifest = generateGeneralAppManifest({ displayName: 'X' });
    await expect(
      createZoomMarketplaceApp({ zoomApiBase: 'https://zoom.us', accessToken: 't', manifest }),
    ).rejects.toThrow(/app_id/);
  });
});

describe('createAppFromManifest', () => {
  it('uses the public OAuth token to create an app', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ app_id: 'A1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const manifest = generateGeneralAppManifest({ displayName: 'X' });
    const res = await createAppFromManifest({
      env: { zoomApiBase: 'https://zoom.us' },
      manifest,
      creds: { publicOAuth: true },
      appInfo: { appName:'X', contactName:'Developer', contactEmail:'dev@example.com', companyName:'Example' },
    });
    expect(res.appId).toBe('A1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
