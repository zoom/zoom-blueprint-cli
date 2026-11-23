import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateAppManifest, getAppManifest, updateAppManifest } from '../../src/marketplace/client.js';
import { generateGeneralAppManifest } from '../../src/manifest/index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const manifest = generateGeneralAppManifest({ displayName: 'X' });
const base = { zoomApiBase: 'https://zoom.us', accessToken: 't' };

function resp(status: number, body: unknown) {
  // 204/205/304 must not carry a body.
  const noBody = body == null || status === 204 || status === 205 || status === 304;
  return new Response(noBody ? null : JSON.stringify(body), { status });
}

describe('validateAppManifest', () => {
  it('returns ok:true on a clean validation (does not trust bare HTTP 200 — checks the body)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { ok: true })));
    const r = await validateAppManifest({ ...base, manifest });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('returns ok:false with field-level issues (even on a 200 body carrying errors)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resp(200, { ok: false, error: 'invalid_manifest', errors: [{ setting: 'display_name', message: 'too long' }] })),
    );
    const r = await validateAppManifest({ ...base, manifest });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ setting: 'display_name', message: 'too long' }]);
  });

  it('surfaces a 400 invalid_manifest as a validation failure (not a thrown error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { error: 'invalid_manifest', errors: [{ message: 'bad' }] })));
    const r = await validateAppManifest({ ...base, manifest });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toBe('bad');
  });

  it('THROWS on an auth error (no validation issues present)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(401, { code: 124, message: 'Invalid token' })));
    await expect(validateAppManifest({ ...base, manifest })).rejects.toThrow(/HTTP 401/);
  });

  it('sends the bare manifest and app_id when provided', async () => {
    const fetchMock = vi.fn(async () => resp(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await validateAppManifest({ ...base, manifest, appId: 'APP9' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.app_id).toBe('APP9');
    expect(body.manifest.display_information.display_name).toBe('X');
  });
});

describe('getAppManifest', () => {
  it('returns the bare inner manifest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { manifest: { display_information: { display_name: 'Remote' } } })));
    const m = await getAppManifest({ ...base, appId: 'APP9' });
    expect(m.display_information.display_name).toBe('Remote');
  });
  it('throws on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(404, { code: 300, message: 'not found' })));
    await expect(getAppManifest({ ...base, appId: 'nope' })).rejects.toThrow(/HTTP 404/);
  });
});

describe('updateAppManifest', () => {
  it('PUTs the wrapped manifest and treats 204 as success', async () => {
    const fetchMock = vi.fn(async () => resp(204, null));
    vi.stubGlobal('fetch', fetchMock);
    const r = await updateAppManifest({ ...base, appId: 'APP9', manifest });
    expect(r.status).toBe(204);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v2/marketplace/apps/APP9/manifest');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body as string).manifest).toBeTruthy();
  });
  it('throws on a validation failure during update', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(400, { error: 'invalid_manifest', errors: [{ setting: 'x', message: 'y' }] })));
    await expect(updateAppManifest({ ...base, appId: 'APP9', manifest })).rejects.toThrow(/invalid_manifest|x: y/);
  });
});
