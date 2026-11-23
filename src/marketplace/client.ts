// Marketplace HTTP operations. Authentication headers and returned client secrets are never logged.
// Errors retain HTTP/Zoom details for actionable reports; secret-shaped values are redacted.

import type { AppInfo } from '../types.js';
import { getPublicAccessToken } from '../auth/pkce.js';
import { redactSecrets } from '../util/errors.js';
import { wrapManifestForCreateApp, type ZoomManifest } from '../manifest/index.js';
import type { ZoomCredentials } from '../config/env.js';

export interface CreateAppResult {
  appId: string;
  clientId?: string;
  clientSecret?: string; // Save only in the protected project .env.
  oauthAuthorizeUrl?: string;
  raw: Record<string, any>;
}

export interface ZoomApiError extends Error {
  status?: number;
  body?: unknown;
  zoomError?: { code?: number; message?: string };
}

/** Resolve the public OAuth session; management secrets are not supported. */
export async function getZoomAccessToken({ zoomApiBase }: { zoomApiBase: string } & ZoomCredentials): Promise<string> {
  return getPublicAccessToken(zoomApiBase);
}

/** Create a Zoom Marketplace app from a bare manifest object (wrapped in { manifest } here). */
export async function createZoomMarketplaceApp({
  zoomApiBase,
  accessToken,
  manifest,
  appInfo,
}: {
  appInfo?: AppInfo;
  zoomApiBase: string;
  accessToken: string;
  manifest: ZoomManifest;
}): Promise<CreateAppResult> {
  if (!zoomApiBase) throw new Error('createZoomMarketplaceApp: zoomApiBase is required');
  if (!accessToken) throw new Error('createZoomMarketplaceApp: accessToken is required');
  if (!manifest) throw new Error('createZoomMarketplaceApp: manifest is required');

  const url = `${zoomApiBase}/v2/marketplace/apps`;
  const body = {
    ...wrapManifestForCreateApp(manifest),
    ...(appInfo ? { app_type: 'general', app_name: appInfo.appName, contact_name: appInfo.contactName,
      contact_email: appInfo.contactEmail, company_name: appInfo.companyName } : {}),
  }; // product guard is applied upstream in provision

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await parseJson(res);
  if (!res.ok) throw zoomError('Zoom Create App request', res, json);
  if (!json.app_id) {
    throw new Error(`Zoom Create App response did not include app_id (HTTP ${res.status}).`);
  }
  return {
    appId: json.app_id,
    clientId: (json.credentials ?? json.development_credentials)?.client_id,
    clientSecret: (json.credentials ?? json.development_credentials)?.client_secret, // sensitive — only written to the protected project .env
    oauthAuthorizeUrl: json.oauth_authorize_url,
    raw: json,
  };
}

/** Convenience: mint a token then create the app in one call. */
export async function createAppFromManifest({
  env,
  manifest,
  creds,
  appInfo,
}: {
  appInfo?: AppInfo;
  env: { zoomApiBase: string };
  manifest: ZoomManifest;
  creds: ZoomCredentials;
}): Promise<CreateAppResult> {
  const zoomApiBase = env.zoomApiBase;
  const accessToken = await getZoomAccessToken({ zoomApiBase, ...creds });
  if (!appInfo) throw new Error('Developer contact information is required for public OAuth provisioning. Run zoom app create interactively.');
  return createZoomMarketplaceApp({ zoomApiBase: marketplaceApiBase(zoomApiBase, creds), accessToken, manifest, appInfo });
}

/** Delete a Zoom Marketplace app by app_id. */
export async function deleteZoomMarketplaceApp({
  zoomApiBase,
  accessToken,
  appId,
}: {
  zoomApiBase: string;
  accessToken: string;
  appId: string;
}): Promise<void> {
  if (!zoomApiBase) throw new Error('deleteZoomMarketplaceApp: zoomApiBase is required');
  if (!accessToken) throw new Error('deleteZoomMarketplaceApp: accessToken is required');
  if (!appId) throw new Error('deleteZoomMarketplaceApp: appId is required');

  const url = `${zoomApiBase}/v2/marketplace/apps/${encodeURIComponent(appId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // Zoom may return 204 No Content on success, or 200 with a body
  if (res.status === 204) return;

  const json = await parseJson(res);
  if (!res.ok) throw zoomError('Zoom Delete App request', res, json);
}

/** Convenience: mint a token then delete the app in one call. */
export async function deleteAppById({
  env,
  appId,
  creds,
}: {
  env: { zoomApiBase: string };
  appId: string;
  creds: ZoomCredentials;
}): Promise<void> {
  const zoomApiBase = env.zoomApiBase;
  const accessToken = await getZoomAccessToken({ zoomApiBase, ...creds });
  return deleteZoomMarketplaceApp({ zoomApiBase: marketplaceApiBase(zoomApiBase, creds), accessToken, appId });
}

export interface ManifestValidationIssue {
  setting?: string;
  message: string;
}
export interface ManifestValidationResult {
  ok: boolean;
  status: number;
  issues: ManifestValidationIssue[];
  raw: Record<string, any>;
}

/**
 * Validate a manifest WITHOUT creating an app (dry-run).
 * POST {zoomApiBase}/v2/marketplace/apps/manifest/validate   body: { manifest, app_id? }
 *
 * CRITICAL: a 200 is NOT sufficient evidence of validity — Zoom returns field-level issues in the
 * body (`{ ok:false, error:'invalid_manifest', errors:[{setting,message}] }`), sometimes with a
 * non-2xx status. We surface `ok:false` with the issues for a validation failure, and only THROW for
 * auth/permission/server errors (no validation issues present).
 */
export async function validateAppManifest({
  zoomApiBase,
  accessToken,
  manifest,
  appId,
}: {
  zoomApiBase: string;
  accessToken: string;
  manifest: ZoomManifest;
  appId?: string;
}): Promise<ManifestValidationResult> {
  if (!zoomApiBase) throw new Error('validateAppManifest: zoomApiBase is required');
  if (!accessToken) throw new Error('validateAppManifest: accessToken is required');
  if (!manifest) throw new Error('validateAppManifest: manifest is required');

  const url = `${zoomApiBase}/v2/marketplace/apps/manifest/validate`;
  const bare = wrapManifestForCreateApp(manifest).manifest;
  const body: Record<string, unknown> = { manifest: bare };
  if (appId) body.app_id = appId;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await parseJson(res);
  const issues = extractManifestIssues(json);
  if (issues.length) return { ok: false, status: res.status, issues, raw: json };
  if (!res.ok) throw zoomError('Zoom manifest validation', res, json); // auth/permission/server error
  return { ok: true, status: res.status, issues: [], raw: json };
}

/**
 * Retrieve an existing app's current manifest.
 * GET {zoomApiBase}/v2/marketplace/apps/{appId}/manifest  →  { manifest: {...} }
 * Returns the bare inner manifest object.
 */
export async function getAppManifest({
  zoomApiBase,
  accessToken,
  appId,
}: {
  zoomApiBase: string;
  accessToken: string;
  appId: string;
}): Promise<ZoomManifest> {
  if (!zoomApiBase) throw new Error('getAppManifest: zoomApiBase is required');
  if (!accessToken) throw new Error('getAppManifest: accessToken is required');
  if (!appId) throw new Error('getAppManifest: appId is required');

  const url = `${zoomApiBase}/v2/marketplace/apps/${encodeURIComponent(appId)}/manifest`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await parseJson(res);
  if (!res.ok) throw zoomError('Zoom get manifest', res, json);
  return (json.manifest ?? json) as ZoomManifest;
}

export interface AppMetadata {
  appId: string;
  /** Human app name (Marketplace display name). Usable as a ZOOM_BOT_NAME default. */
  appName?: string;
  appType?: string;
  appStatus?: string;
  raw: Record<string, any>;
}

/**
 * Retrieve an app's public metadata.
 *   GET {zoomApiBase}/v2/marketplace/apps/{appId}
 *
 * IMPORTANT: this endpoint returns only app_name / app_description / app_type / app_status / scopes —
 * it does NOT expose client_id, redirect URLs, event subscriptions, or the Chatbot Bot JID. The Bot
 * JID is not retrievable from any documented API (it is dashboard-only, and echoed in webhook
 * payloads at runtime). Callers must treat the JID as developer-supplied, not fetched. We use this
 * only for a best-effort ZOOM_BOT_NAME default.
 */
export async function getApp({
  zoomApiBase,
  accessToken,
  appId,
}: {
  zoomApiBase: string;
  accessToken: string;
  appId: string;
}): Promise<AppMetadata> {
  if (!zoomApiBase) throw new Error('getApp: zoomApiBase is required');
  if (!accessToken) throw new Error('getApp: accessToken is required');
  if (!appId) throw new Error('getApp: appId is required');

  const url = `${zoomApiBase}/v2/marketplace/apps/${encodeURIComponent(appId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await parseJson(res);
  if (!res.ok) throw zoomError('Zoom get app', res, json);
  return {
    appId: json.app_id ?? appId,
    appName: json.app_name,
    appType: json.app_type,
    appStatus: json.app_status,
    raw: json,
  };
}

/**
 * Update (REPLACE) an existing app's manifest. Zoom's PUT replaces the ENTIRE configuration, so the
 * body must carry all modified AND unmodified fields — callers must merge onto the fetched remote,
 * not send a partial patch. Success is 204 No Content.
 * PUT {zoomApiBase}/v2/marketplace/apps/{appId}/manifest  body: { manifest }
 */
export async function updateAppManifest({
  zoomApiBase,
  accessToken,
  appId,
  manifest,
}: {
  zoomApiBase: string;
  accessToken: string;
  appId: string;
  manifest: ZoomManifest;
}): Promise<{ status: number }> {
  if (!zoomApiBase) throw new Error('updateAppManifest: zoomApiBase is required');
  if (!accessToken) throw new Error('updateAppManifest: accessToken is required');
  if (!appId) throw new Error('updateAppManifest: appId is required');
  if (!manifest) throw new Error('updateAppManifest: manifest is required');

  const url = `${zoomApiBase}/v2/marketplace/apps/${encodeURIComponent(appId)}/manifest`;
  const body = wrapManifestForCreateApp(manifest);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await parseJson(res);
    throw zoomError('Zoom update manifest', res, json);
  }
  return { status: res.status };
}

// ---- internals -------------------------------------------------------------

async function parseJson(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// Zoom uses two error shapes:
//   1. { code, message }                                                  (generic service errors)
//   2. { ok:false, error:'invalid_manifest', errors:[{setting,message}] } (manifest validation)
function zoomError(label: string, res: Response, json: Record<string, any>): ZoomApiError {
  const { code, message } = summarizeZoomError(json);
  const err = new Error(
    `${label} failed: HTTP ${res.status}${code !== undefined ? ` (code ${code})` : ''}${
      message ? ` - ${redactSecrets(String(message))}` : ''
    }`,
  ) as ZoomApiError;
  err.status = res.status;
  err.body = json;
  if (code !== undefined || message) err.zoomError = { code, message };
  return err;
}

// Pull field-level manifest issues out of a validation response (either error shape).
function extractManifestIssues(json: Record<string, any>): ManifestValidationIssue[] {
  if (!json || typeof json !== 'object') return [];
  const issues: ManifestValidationIssue[] = [];
  if (Array.isArray(json.errors)) {
    for (const e of json.errors) {
      if (e && (e.message || e.setting)) issues.push({ setting: e.setting, message: String(e.message ?? 'invalid') });
    }
  }
  // A bare `{ ok:false, error:'invalid_manifest' }` with no errors[] still signals failure.
  if (!issues.length && json.ok === false && json.error) {
    issues.push({ message: String(json.error) });
  }
  return issues;
}

function summarizeZoomError(json: Record<string, any>): { code?: number; message?: string } {
  if (!json || typeof json !== 'object') return { code: undefined, message: undefined };
  let { code, message } = json as { code?: number; message?: string };
  if (!message) {
    const parts: string[] = [];
    if (json.reason) parts.push(String(json.reason)); // e.g. "The application doesn't support account_credential"
    if (json.error) parts.push(String(json.error)); // e.g. "invalid_manifest" / "unsupported_grant_type"
    if (Array.isArray(json.errors)) {
      for (const e of json.errors) {
        if (e && e.message) parts.push(`${e.setting ? e.setting + ': ' : ''}${e.message}`);
      }
    }
    if (parts.length) message = parts.join('; ');
  }
  return { code, message };
}

/** Public OAuth uses the documented commercial API host, with OAuth kept on zoom.us. */
export function marketplaceApiBase(base: string, _creds: ZoomCredentials): string {
  return base === 'https://zoom.us' ? 'https://api.zoom.us' : base;
}
