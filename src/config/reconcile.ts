// Post-creation configuration reconciliation — the single owner of "turn the active dev URL + app
// metadata into the generated project's runtime .env values." Called from both `zoom configure` and
// `zoom dev`, so the logic lives here once (pure + dependency-injected for tests).
//
// Design rules (from the spec):
//   • Distinguish GENERATED values (derived from the dev URL — safe to refresh when the tunnel moves)
//     from DEVELOPER-SUPPLIED values (Bot JID, Secret Token — no API exposes them; prompt + validate).
//   • NEVER overwrite an existing real (non-placeholder) secret/identifier without confirmation.
//   • NEVER copy CLI management tokens into the project .env (that separation lives upstream; this
//     module only ever touches the keys a template's `reconcile` spec names).
//   • Report every unresolved REQUIRED value with actionable guidance instead of failing silently.
//   • One atomic multi-key write; comments/order preserved; 0600.

import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readEnvFile, readEnvValue, writeEnvVars } from './envfile.js';
import type { EnvReconcileSpec } from '../templates/registry.js';

/** A value is a "placeholder" when it is empty, a `{{token}}`, or a scaffold stand-in like `your_x_here`. */
export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const v = value.trim();
  if (v === '') return true;
  if (/\{\{.*\}\}/.test(v)) return true; // unresolved manifest-style token
  if (/^your[_-].*(_here)?$/i.test(v)) return true; // your_bot_jid_here, your-x
  if (/your_[a-z0-9_]+_here/i.test(v)) return true; // embedded, e.g. https://your_tunnel_url_here/cb
  if (/your[-_]tunnel[-_]url/i.test(v)) return true;
  if (/your-db-name\.upstash\.io/i.test(v)) return true;
  if (/^change-this/i.test(v)) return true; // change-this-to-a-long-random-string-in-production
  if (/^(changeme|placeholder|todo|xxx+|replace[-_]me|app-client-id|app-client-secret|created-app-id)$/i.test(v)) return true;
  if (/^(?:sk-(?:ant-)?(?:\.\.\.|…)|x+@xmpp\.zoom\.us|<[^>]+>)$/i.test(v)) return true;
  if (/^https?:\/\/example\.ngrok\.app(?:[/:?#]|$)/i.test(v)) return true;
  return false;
}

/** Validate a Zoom Chatbot Bot JID (shape `local@domain`, e.g. `…@xmpp.zoom.us`). */
export function validateBotJid(value: string): string | null {
  const v = value.trim();
  if (isPlaceholderValue(v)) return 'looks like a placeholder';
  if (/\s/.test(v)) return 'must not contain spaces';
  if (!/^[^@\s]+@[^@\s]+$/.test(v)) return 'expected the form "<id>@xmpp.zoom.us"';
  return null;
}

/** Validate a Zoom webhook Secret Token (opaque, non-trivial, no whitespace). */
export function validateSecretToken(value: string): string | null {
  const v = value.trim();
  if (isPlaceholderValue(v)) return 'looks like a placeholder';
  if (/\s/.test(v)) return 'must not contain spaces';
  if (v.length < 8) return 'too short to be a real Secret Token';
  return null;
}

const VALIDATORS: Record<string, (v: string) => string | null> = {
  botJid: validateBotJid,
  secretToken: validateSecretToken,
};

/** True for keys whose value must never be echoed (tokens/secrets). Bot JID is public (not redacted). */
function isSecretKey(key: string): boolean {
  return /secret|token|password|credential|api[_-]?key/i.test(key);
}

export type ReconcileAction = 'set-url' | 'set-origin' | 'refreshed-url' | 'generated' | 'prompted' | 'app-name';
export interface ReconcileChange {
  key: string;
  action: ReconcileAction;
  label?: string;
  /** Human-safe display (secrets shown as a marker, never the value). */
  display: string;
}
export interface ReconcileUnresolved {
  key: string;
  label?: string;
  /** Actionable guidance on how to obtain/set this value. */
  how: string;
}
export interface ReconcileResult {
  envPath: string;
  changes: ReconcileChange[];
  unresolved: ReconcileUnresolved[];
  /** True when at least one value was written to .env. */
  wrote: boolean;
}

export interface ReconcileDeps {
  signal?: AbortSignal;
  readEnv?: (p: string) => Promise<string | null>;
  writeEnv?: (p: string, entries: Array<{ key: string; value: string }>) => Promise<{ path: string; created: boolean }>;
  /** Prompt for a developer-supplied value. Return undefined/'' to skip. */
  prompt?: (q: { message: string; help?: string; secret?: boolean }) => Promise<string | undefined>;
  /** Acknowledge a setting after it has been written. */
  onSaved?: (label: string) => void;
  /** Generate a random secret (hex). */
  generateSecret?: () => string;
  /** Confirm replacing an existing non-placeholder value. Default: do not replace (returns false). */
  confirm?: (message: string) => Promise<boolean>;
  /** Best-effort Marketplace app name (for a bot-name default). Return undefined on any failure. */
  getAppName?: (appId: string) => Promise<string | undefined>;
}

export interface ReconcileOptions {
  dir: string;
  spec?: EnvReconcileSpec;
  /** Template's required env (for unresolved reporting beyond the spec's own prompt vars). */
  requiredEnv?: string[];
  /** Active development base URL (e.g. the ngrok https URL). */
  baseUrl?: string;
  /** Allow interactive prompts for developer-supplied values. */
  interactive?: boolean;
  /** Linked Marketplace app id (for the app-name lookup). */
  appId?: string;
  /** App editor URL shown for settings that require a Marketplace visit. */
  marketplaceAppUrl?: string;
  marketplaceSettingsUrl?: (page: 'surface' | 'access') => string;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
function isDevHost(host: string): boolean {
  return /^localhost(:\d+)?$/i.test(host) || /^127\.0\.0\.1/.test(host) || /ngrok(-free)?\.(app|io|dev)$/i.test(host);
}

/**
 * Reconcile the project's runtime `.env`. Returns the planned/applied changes and any values still
 * unresolved. Writes atomically unless there is nothing to change.
 */
export async function reconcileConfig(opts: ReconcileOptions, deps: ReconcileDeps = {}): Promise<ReconcileResult> {
  const readEnv = deps.readEnv ?? readEnvFile;
  const writeEnv = deps.writeEnv ?? writeEnvVars;
  const generateSecret = deps.generateSecret ?? (() => randomBytes(32).toString('hex'));
  const spec = opts.spec ?? {};
  const envPath = path.join(opts.dir, '.env');
  const contents = await readEnv(envPath);

  const pending: Array<{ key: string; value: string }> = [];
  const changes: ReconcileChange[] = [];
  const unresolved: ReconcileUnresolved[] = [];

  const resolved = (key: string): string | undefined => {
    const p = pending.find((e) => e.key === key);
    return p ? p.value : readEnvValue(contents, key);
  };
  const set = (key: string, value: string, action: ReconcileAction, label?: string): void => {
    pending.push({ key, value });
    const display = isSecretKey(key) ? `(${action === 'generated' ? 'generated' : 'set'})` : value;
    changes.push({ key, action, label, display });
  };
  const addUnresolved = (key: string, label: string | undefined, how: string): void => {
    if (!unresolved.some((u) => u.key === key)) unresolved.push({ key, label, how });
  };

  // 1. URL-derived values (generated — safe to refresh when the tunnel URL changes).
  for (const uv of spec.urlVars ?? []) {
    const label = uv.label;
    if (!opts.baseUrl) {
      if (isPlaceholderValue(resolved(uv.name))) {
        addUnresolved(uv.name, label, 'Run `zoom dev` (or pass --url) so the active development URL can be applied.');
      }
      continue;
    }
    const base = opts.baseUrl.replace(/\/+$/, '');
    const route = uv.route ? (uv.route.startsWith('/') ? uv.route : `/${uv.route}`) : '';
    const desired = uv.kind === 'origin' ? originOf(opts.baseUrl) : `${base}${route}`;
    const cur = resolved(uv.name);
    if (cur === desired) continue; // already correct
    if (isPlaceholderValue(cur)) {
      set(uv.name, desired, uv.kind === 'origin' ? 'set-origin' : 'set-url', label);
    } else {
      // Non-placeholder but different. Refresh freely for dev/placeholder hosts; otherwise confirm.
      const curHost = hostOf(cur as string);
      if (isDevHost(curHost) || curHost === hostOf(desired) || curHost === '') {
        set(uv.name, desired, 'refreshed-url', label);
      } else if (deps.confirm && (await deps.confirm(`Replace ${uv.name} (${cur}) with ${desired}?`))) {
        set(uv.name, desired, 'refreshed-url', label);
      }
      // else: keep the developer's deliberate non-dev value.
    }
  }

  // 2. Bot name default from Marketplace app metadata (best-effort; only fills a placeholder).
  if (spec.appNameVar && isPlaceholderValue(resolved(spec.appNameVar.name))) {
    if (opts.appId && deps.getAppName) {
      let name: string | undefined;
      try {
        name = await deps.getAppName(opts.appId);
      } catch {
        name = undefined;
      }
      if (name && !isPlaceholderValue(name)) {
        set(spec.appNameVar.name, name, 'app-name', spec.appNameVar.label);
      } else {
        addUnresolved(
          spec.appNameVar.name,
          spec.appNameVar.label,
          'Could not read the app name from Zoom — set it to your bot\'s display name.',
        );
      }
    } else {
      addUnresolved(
        spec.appNameVar.name,
        spec.appNameVar.label,
        'Set it to your bot\'s display name (or run `zoom dev`/`configure` after zoom login to auto-fill).',
      );
    }
  }

  // 3. Auto-generated secrets (only when still a placeholder — never overwrite a real one).
  for (const gv of spec.generateVars ?? []) {
    if (isPlaceholderValue(resolved(gv.name))) {
      set(gv.name, generateSecret(), 'generated', gv.label);
    }
  }

  let written = 0;
  const flush = async () => {
    deps.signal?.throwIfAborted();
    if (written === pending.length) return;
    await writeEnv(envPath, pending.slice(written));
    written = pending.length;
  };

  // Save each accepted setting so a dashboard visit or interruption can be resumed.
  for (const pv of spec.promptVars ?? []) {
    const cur = resolved(pv.name);
    const validate = pv.validate ? VALIDATORS[pv.validate] : undefined;
    if (cur && !isPlaceholderValue(cur) && !validate?.(cur)) continue;

    const settingsUrl = pv.marketplacePage && opts.marketplaceSettingsUrl?.(pv.marketplacePage);
    const url = settingsUrl || opts.marketplaceAppUrl;
    const location = url
      ? `Open Marketplace ${settingsUrl ? pv.marketplacePage : 'app'}\n  ${url}`
      : 'Run zoom app create to create and link an app, or zoom app link --app-id <id> for an existing app.';
    const help = `${location}\n\n${pv.help ?? 'Set this value from the Marketplace app.'}`;
    if (opts.interactive && deps.prompt) {
      let error = cur && !isPlaceholderValue(cur) ? validate?.(cur) : null;
      let accepted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const answer = (await deps.prompt({
          message: `Paste ${pv.label}, or press Enter to do this later`,
          help: attempt > 0 ? `Invalid: ${error}.` : error ? `Invalid: ${error}.\n\n${help}` : help,
          secret: isSecretKey(pv.name),
        }))?.trim();
        if (!answer) break;
        error = validate?.(answer) ?? null;
        if (error) continue;
        set(pv.name, answer, 'prompted', pv.label);
        await flush();
        deps.onSaved?.(pv.label);
        accepted = true;
        break;
      }
      if (!accepted) addUnresolved(pv.name, pv.label, help);
    } else {
      addUnresolved(pv.name, pv.label, help);
    }
  }

  // 5. Any remaining REQUIRED env vars still unset/placeholder (beyond what the spec covered).
  for (const key of opts.requiredEnv ?? []) {
    if (isPlaceholderValue(resolved(key)) && !unresolved.some((u) => u.key === key)) {
      addUnresolved(key, undefined, 'Required by this template — set it in the project .env.');
    }
  }

  await flush();
  return { envPath, changes, unresolved, wrote: written > 0 };
}
