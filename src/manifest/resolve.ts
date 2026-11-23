// Pure manifest resolution + diff helpers, shared by `zoom app validate | diff | sync` and
// `zoom dev`. No network, no I/O — deterministic and unit-testable.
//
// The template's manifest (from its manifest/ directory) is the SOURCE OF TRUTH. These helpers
// apply only the project/environment-specific changes on top of a deep clone, so unrelated template
// settings are preserved.

import { redactSecrets, CliError } from '../util/errors.js';
import type { ZoomManifest } from './index.js';

/**
 * The ONLY placeholders the resolver understands. This is intentionally tiny — not a general
 * templating engine. Template authors put these literal tokens in their canonical manifest; the CLI
 * replaces them with trusted, explicit values (never arbitrary env vars or expressions).
 */
export const SUPPORTED_PLACEHOLDERS = ['APP_NAME', 'DEV_BASE_URL', 'DEV_HOSTNAME'] as const;
export type PlaceholderKey = (typeof SUPPORTED_PLACEHOLDERS)[number];

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/** Return the distinct placeholder names (without braces) still present anywhere in the value. */
export function findUnresolvedPlaceholders(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return [...found];
}

/** True when the value contains any `{{...}}` placeholder. */
export function manifestHasPlaceholders(value: unknown): boolean {
  return findUnresolvedPlaceholders(value).length > 0;
}

/** Throw unless `url` is a well-formed https:// URL. */
export function assertHttpsUrl(url: string, label = 'development base URL'): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(`Invalid ${label}: "${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new CliError(`Invalid ${label}: "${url}" must use https:// (got ${parsed.protocol}).`);
  }
}

/** Reach through a `{ manifest: {...} }` wrapper to the inner object (or return the object itself). */
export function innerManifest(m: ZoomManifest): ZoomManifest {
  return m && m.manifest && m.display_information === undefined ? (m.manifest as ZoomManifest) : m;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** Get a value by dotted JSON path (e.g. "oauth_information.production_redirect_uri"). */
export function getPath(obj: Record<string, any>, dotted: string): unknown {
  return dotted.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Set a value by dotted JSON path, creating intermediate objects as needed. */
export function setPath(obj: Record<string, any>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
}

/** Recursively replace `{{VAR}}` tokens inside every string value. Unknown tokens are left intact. */
export function resolvePlaceholders<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in vars ? vars[k] : `{{${k}}}`)) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(v, vars)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolvePlaceholders(v, vars);
    return out as T;
  }
  return value;
}

export interface UrlMapping {
  /** Domain allow-list entries need a hostname rather than an HTTPS URL. */
  kind?: 'url' | 'hostname';
  /** JSON path within the INNER manifest (no `manifest.` prefix). */
  path: string;
  /** Route appended to the base URL (e.g. "/auth/callback"); omit/"" for the bare base URL. */
  route?: string;
  /** Human label for diagnostics (e.g. "OAuth callback"). */
  label?: string;
}

/**
 * Apply a public base URL to the manifest's declared URL fields. Returns a NEW manifest (clone);
 * the input is not mutated. Operates on the inner manifest so wrapper shape is preserved.
 */
export function applyUrlMappings(manifest: ZoomManifest, baseUrl: string, mappings: UrlMapping[]): ZoomManifest {
  const clone = deepClone(manifest);
  const inner = innerManifest(clone);
  const base = baseUrl.replace(/\/+$/, '');
  for (const m of mappings) {
    const route = m.route ? (m.route.startsWith('/') ? m.route : `/${m.route}`) : '';
    setPath(inner, m.path, m.kind === 'hostname' ? new URL(base).hostname : `${base}${route}`);
  }
  return clone;
}

export type DiffType = 'added' | 'removed' | 'changed';
export interface DiffEntry {
  path: string;
  type: DiffType;
  /** Proposed (local) value, redacted. */
  local?: string;
  /** Current (remote) value, redacted. */
  remote?: string;
}

const SECRET_PATH_RE = /secret|token|password|credential|api[_-]?key/i;

function render(v: unknown): string {
  if (v === undefined) return '(unset)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * Deep-diff the proposed (local) manifest against the current (remote) one, leaf by leaf. Secret-ish
 * paths and values are redacted. Operates on inner manifests so wrapper differences are ignored.
 */
export function diffManifest(local: ZoomManifest, remote: ZoomManifest): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(innerManifest(local), innerManifest(remote), '', out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function walk(local: any, remote: any, prefix: string, out: DiffEntry[]): void {
  const keys = new Set<string>([
    ...(local && typeof local === 'object' ? Object.keys(local) : []),
    ...(remote && typeof remote === 'object' ? Object.keys(remote) : []),
  ]);
  for (const key of keys) {
    const p = prefix ? `${prefix}.${key}` : key;
    const lv = local?.[key];
    const rv = remote?.[key];
    // Recurse into both objects AND arrays (arrays keyed by index), so a single changed element —
    // e.g. events.0.development_webhook_url — is reported precisely instead of dumping the whole array.
    const bothContainers = lv && rv && typeof lv === 'object' && typeof rv === 'object' && Array.isArray(lv) === Array.isArray(rv);
    if (bothContainers) {
      walk(lv, rv, p, out);
      continue;
    }
    if (equal(lv, rv)) continue;
    const secret = SECRET_PATH_RE.test(p);
    const entry: DiffEntry = {
      path: p,
      type: lv === undefined ? 'removed' : rv === undefined ? 'added' : 'changed',
    };
    if (lv !== undefined) entry.local = secret ? '***REDACTED***' : redactSecrets(render(lv));
    if (rv !== undefined) entry.remote = secret ? '***REDACTED***' : redactSecrets(render(rv));
    out.push(entry);
  }
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
