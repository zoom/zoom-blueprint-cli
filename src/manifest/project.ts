// Load a project's canonical manifest (from the template's manifest/ directory — the SOURCE OF
// TRUTH) and apply only the project/environment-specific changes (public dev URLs, display name,
// placeholder resolution) on top of a clone. Unrelated template settings are preserved.

import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../util/errors.js';
import { readEnvFile } from '../config/envfile.js';
import {
  applyUrlMappings,
  resolvePlaceholders,
  innerManifest,
  deepClone,
  setPath,
  getPath,
  manifestHasPlaceholders,
  findUnresolvedPlaceholders,
  assertHttpsUrl,
  type UrlMapping,
} from './resolve.js';
import { validateManifestInputs, type ZoomManifest } from './index.js';

/**
 * Bootstrap development base URL submitted at app-CREATION time, before any real tunnel exists. It is
 * a valid https URL Zoom accepts; `zoom dev` replaces it with the live ngrok URL. An app created with
 * this value is "pending development URL configuration", not fully configured — see cli.ts messaging.
 */
export const BOOTSTRAP_DEV_URL = 'https://example.ngrok.app';

/** Local structural checks for a manifest (no network). Returns human-readable issues ([] = ok). */
export function localManifestIssues(manifest: ZoomManifest, appType: 'general'): string[] {
  const inner = innerManifest(manifest);
  const issues: string[] = [];
  if (!inner || typeof inner !== 'object') return ['Manifest is not an object.'];
  if (!inner.display_information) issues.push('Missing display_information.');
  issues.push(
    ...validateManifestInputs({
      displayName: inner.display_information?.display_name,
      description: inner.display_information?.description,
      longDescription: inner.display_information?.long_description,
      scopeDescription: inner.oauth_information?.scope_description,
    }),
  );
  if (appType === 'general' && !inner.oauth_information) issues.push('Missing oauth_information (General App).');
  if (!inner.features) issues.push('Missing features.');
  return issues;
}

/** Read + parse the canonical manifest file from the scaffolded project. */
export async function loadCanonicalManifest(projectDir: string, manifestPath: string): Promise<ZoomManifest> {
  const file = path.join(projectDir, manifestPath);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`Manifest not found at ${file}. This template may not declare a Zoom manifest.`);
    }
    throw err;
  }
  try {
    return JSON.parse(raw) as ZoomManifest;
  } catch {
    throw new CliError(`Manifest at ${file} is not valid JSON.`);
  }
}

export interface ResolveOptions {
  /** Development base URL (ngrok today; any https base in future). Must be https when provided. */
  baseUrl?: string;
  /** URL mappings used when updating a resolved or legacy remote manifest. */
  urlMappings?: UrlMapping[];
  /** Value for {{APP_NAME}} / display_name. */
  appName?: string;
  /** Project-specific Zoom Chat slash command, resolved during scaffolding. */
  chatCommand?: string;
  /** Throw if any `{{...}}` remains after resolution (default true). */
  strict?: boolean;
  /** Require baseUrl to be https (default true). */
  requireHttps?: boolean;
}

/**
 * Produce a RESOLVED manifest from a CANONICAL one (never mutates the input). Precedence:
 *
 *   1. If the canonical manifest declares supported URL, hostname, or app-name placeholders, those are
 *      the source of truth — only the supported tokens are substituted (unrelated strings untouched).
 *   2. Otherwise (legacy templates), fall back to `runtime.urlMappings` + a direct display_name set.
 *
 * Placeholders and urlMappings therefore describe the SAME fields for a given template and never
 * compete: a template uses one mechanism or the other. Unknown/unfilled placeholders are a hard
 * error (strict). The base URL must be https.
 */
export function buildResolvedManifest(canonical: ZoomManifest, opts: ResolveOptions = {}): ZoomManifest {
  const { baseUrl, appName, urlMappings, strict = true, requireHttps = true } = opts;
  if (baseUrl && requireHttps) assertHttpsUrl(baseUrl);

  let m = deepClone(canonical);

  if (manifestHasPlaceholders(m)) {
    const values: Record<string, string> = {};
    if (appName !== undefined) values.APP_NAME = appName;
    if (opts.chatCommand !== undefined) values.CHAT_COMMAND = opts.chatCommand;
    if (baseUrl !== undefined) {
      values.DEV_BASE_URL = baseUrl.replace(/\/+$/, '');
      values.DEV_HOSTNAME = new URL(baseUrl).hostname;
    }
    m = resolvePlaceholders(m, values); // replaces ONLY keys we pass; preserves path suffixes & other text
  } else {
    if (appName) setPath(innerManifest(m), 'display_information.display_name', appName);
  }
  // Literal bootstrap URLs still need mapping when other fields contain placeholders.
  if (baseUrl && urlMappings?.length) m = applyUrlMappings(m, baseUrl, urlMappings);

  if (strict) {
    const unresolved = findUnresolvedPlaceholders(m);
    if (unresolved.length) {
      throw new CliError(
        `Unresolved manifest placeholder(s): ${unresolved.map((p) => `{{${p}}}`).join(', ')}. ` +
          `Supported: {{APP_NAME}}, {{CHAT_COMMAND}}, {{DEV_BASE_URL}}, {{DEV_HOSTNAME}}. Provide the value(s) (e.g. a dev base URL).`,
      );
    }
  }
  return m;
}

/** Preview the URLs a resolved manifest would carry, for diagnostics. */
export function previewUrls(manifest: ZoomManifest, mappings: UrlMapping[]): { label: string; url: string }[] {
  const inner = innerManifest(manifest);
  return mappings.map((m) => ({
    label: m.label || m.path,
    url: String(getPath(inner, m.path) ?? ''),
  }));
}

/** Resolve the dev-server port from the project's .env (portEnv) or a fallback. */
export async function readProjectPort(
  projectDir: string,
  portEnv: string | undefined,
  defaultPort: number,
): Promise<number> {
  if (!portEnv) return defaultPort;
  const contents = await readEnvFile(path.join(projectDir, '.env'));
  if (contents) {
    const re = new RegExp(`^\\s*${portEnv}\\s*=\\s*(.+)\\s*$`, 'm');
    const m = contents.match(re);
    if (m) {
      const n = Number(m[1].trim().replace(/^["']|["']$/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  if (process.env[portEnv]) {
    const n = Number(process.env[portEnv]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaultPort;
}
