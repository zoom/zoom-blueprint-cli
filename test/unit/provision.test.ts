import { describe, it, expect, vi } from 'vitest';
import { createZoomApp, isTransientZoomError, backoffMs } from '../../src/marketplace/provision.js';
import { generateGeneralAppManifest } from '../../src/manifest/index.js';
import type { ZoomEnv } from '../../src/config/env.js';

const env: ZoomEnv = { name: 'prod', marketplaceUrl: 'https://marketplace.zoom.us', zoomApiBase: 'https://zoom.us' };
const creds = { accountId: 'a', clientId: 'c', clientSecret: 's' };

function noopDeps() {
  return {
    writeRecovery: vi.fn(async () => 'rec'),
    updateRecovery: vi.fn(async () => 'rec'),
    sleep: vi.fn(async () => {}),
    now: () => '2026-01-01T00:00:00.000Z',
  };
}

describe('isTransientZoomError', () => {
  it('classifies 1500 / 429 / 5xx / service-exception as transient', () => {
    expect(isTransientZoomError({ zoomError: { code: 1500 } })).toBe(true);
    expect(isTransientZoomError({ status: 429 })).toBe(true);
    expect(isTransientZoomError({ status: 503 })).toBe(true);
    expect(isTransientZoomError({ message: 'business verify error' })).toBe(true);
  });

  it('does not treat a genuine invalid_manifest (400) as transient', () => {
    expect(isTransientZoomError({ status: 400, zoomError: { message: 'invalid_manifest' } })).toBe(false);
  });

  it('backoff grows and caps at 10s', () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(10)).toBe(10000);
  });
});

describe('createZoomApp', () => {
  const manifest = generateGeneralAppManifest({ displayName: 'Retry App' });

  it('retries a transient failure then succeeds, persisting only non-secret metadata', async () => {
    const deps = noopDeps();
    const transient = Object.assign(new Error('svc'), { status: 503 });
    const createAppFromManifest = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ appId: 'APP1', clientId: 'cid', clientSecret: 'SECRET', oauthAuthorizeUrl: 'u', raw: {} });

    const res = await createZoomApp({
      env,
      zoomCreds: creds,
      manifest,
      options: { createAppRetries: 3 },
      deps: { ...deps, createAppFromManifest },
    });

    expect(res.appId).toBe('APP1');
    expect(createAppFromManifest).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    // The client secret must never be written into a recovery record.
    const persisted = JSON.stringify(deps.updateRecovery.mock.calls);
    expect(persisted).not.toContain('SECRET');
    expect(persisted).toContain('APP1');
  });

  it('does NOT retry a genuine invalid_manifest and marks the record failed', async () => {
    const deps = noopDeps();
    const invalid = Object.assign(new Error('invalid_manifest'), {
      status: 400,
      zoomError: { message: 'invalid_manifest' },
    });
    const createAppFromManifest = vi.fn().mockRejectedValue(invalid);

    await expect(
      createZoomApp({ env, zoomCreds: creds, manifest, options: { createAppRetries: 3 }, deps: { ...deps, createAppFromManifest } }),
    ).rejects.toThrow(/invalid_manifest/);
    expect(createAppFromManifest).toHaveBeenCalledTimes(1); // no retry
    expect(deps.updateRecovery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }));
  });

  it('applies the product guard before submitting', async () => {
    const deps = noopDeps();
    const m = generateGeneralAppManifest({ displayName: 'Guard' });
    const createAppFromManifest = vi.fn(async ({ manifest }: any) => {
      expect(manifest.features.products).toContain('ZOOM_AIC');
      return { appId: 'A', raw: {} };
    });
    await createZoomApp({
      env,
      zoomCreds: creds,
      manifest: m,
      options: { products: ['ZOOM_AIC'] },
      deps: { ...deps, createAppFromManifest },
    });
    expect(createAppFromManifest).toHaveBeenCalled();
  });
});

it('redacts secrets in failed-create recovery metadata', async () => {
  const deps = noopDeps();
  await expect(createZoomApp({ env, zoomCreds: creds,
    manifest: generateGeneralAppManifest({ displayName: 'Secret-safe recovery' }),
    deps: { ...deps, createAppFromManifest: async () => { throw new Error('client_secret=fake-recovery-secret'); } },
  })).rejects.toThrow();
  expect(JSON.stringify(deps.updateRecovery.mock.calls)).not.toContain('fake-recovery-secret');
  expect(JSON.stringify(deps.updateRecovery.mock.calls)).toContain('REDACTED');
});
