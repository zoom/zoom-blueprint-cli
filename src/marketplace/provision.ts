import type { AppInfo } from '../types.js';
// Provision an app and retain non-secret recovery metadata.
// Transient errors currently use bounded retries. Do not assume a failed create request
// proves no app was created: changing this policy requires an API/idempotency review.

import { redactSecrets } from '../util/errors.js';
import { ensureProducts, type ZoomManifest } from '../manifest/index.js';
import { createAppFromManifest as _createAppFromManifest, type CreateAppResult, type ZoomApiError } from './client.js';
import { writeRecovery as _writeRecovery, updateRecovery as _updateRecovery } from '../util/recovery.js';
import type { ZoomCredentials, ZoomEnv } from '../config/env.js';

/** True for Zoom code 1500, HTTP 429, any 5xx, or a service-exception/business-verify body. */
export function isTransientZoomError(err: unknown): boolean {
  if (!err) return false;
  const e = err as ZoomApiError;
  const code = e.zoomError?.code;
  if (code === 1500) return true;
  const status = e.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return true;
  return /service_exception|business verify error|service error/i.test(zoomErrorText(e));
}

function zoomErrorText(err: ZoomApiError): string {
  const bits: string[] = [];
  if (err.zoomError?.message) bits.push(String(err.zoomError.message));
  if (err.body) {
    try {
      bits.push(typeof err.body === 'string' ? err.body : JSON.stringify(err.body));
    } catch {
      /* ignore */
    }
  }
  if (err.message) bits.push(String(err.message));
  return bits.join(' ');
}

/** ~1s, 2s, 4s, capped at 10s. */
export function backoffMs(attempt: number): number {
  return Math.min(10000, 1000 * Math.pow(2, attempt - 1));
}

export interface CreateZoomAppOptions {
  appInfo?: AppInfo;
  createAppRetries?: number;
  recoveryId?: string;
  /** Products to guarantee on the manifest before POST (e.g. AIC products for AI Companion agents). */
  products?: string[];
}

export interface CreateZoomAppDeps {
  createAppFromManifest?: typeof _createAppFromManifest;
  writeRecovery?: typeof _writeRecovery;
  updateRecovery?: typeof _updateRecovery;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface CreateZoomAppResult {
  status: 'success';
  appId: string;
  clientId?: string;
  clientSecret?: string;
  oauthAuthorizeUrl?: string;
}

/**
 * Create a General-App Marketplace app from a manifest, with bounded retry on transient errors and
 * crash-safe recovery records. Returns the created identifiers (the caller decides what to persist;
 * the client secret may be saved only in the protected project .env, never in recovery records).
 */
export async function createZoomApp({
  env,
  zoomCreds,
  manifest,
  options = {},
  deps = {},
}: {
  env: ZoomEnv;
  zoomCreds: ZoomCredentials;
  manifest: ZoomManifest;
  options?: CreateZoomAppOptions;
  deps?: CreateZoomAppDeps;
}): Promise<CreateZoomAppResult> {
  const {
    createAppFromManifest = _createAppFromManifest,
    writeRecovery = _writeRecovery,
    updateRecovery = _updateRecovery,
    now = () => new Date().toISOString(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = deps;

  // Final product guard right before submit (matches the source's pre-POST guard).
  if (options.products?.length) ensureProducts(manifest, options.products);

  const recId = options.recoveryId || manifest?.display_information?.alias_name || 'app';
  await writeRecovery({ id: recId, createdAt: now(), env: env.name, alias: recId, status: 'creating' });

  const maxAttempts = Math.max(1, Number(options.createAppRetries ?? 3));
  let result: CreateAppResult | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      result = await createAppFromManifest({ env, manifest, creds: zoomCreds, appInfo: options.appInfo });
      break;
    } catch (err) {
      if (isTransientZoomError(err) && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      await updateRecovery(recId, { status: 'failed', error: redactSecrets((err as Error).message) });
      throw err; // genuine invalid_manifest / auth errors are not retried
    }
  }

  // Persist NON-SECRET metadata only — never the client secret.
  await updateRecovery(recId, {
    status: 'complete',
    marketplaceAppId: result.appId,
    appClientId: result.clientId,
    oauthAuthorizeUrl: result.oauthAuthorizeUrl,
  });

  return {
    status: 'success',
    appId: result.appId,
    clientId: result.clientId,
    clientSecret: result.clientSecret,
    oauthAuthorizeUrl: result.oauthAuthorizeUrl,
  };
}
