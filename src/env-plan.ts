// Build the environment-variable plan for a scaffolded project and write .env / .env.example.
//
// Only variables actually required by the selected template + provider + app type are included.
// Secrets go to .env (0600, gitignored); .env.example always carries placeholders, never real keys.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDERS, type ProviderId } from './providers.js';
import type { Template, AppType } from './templates/registry.js';

export interface EnvEntry {
  key: string;
  /** Real value for .env ('' = developer must supply). */
  value: string;
  /** Placeholder shown in .env.example. */
  placeholder: string;
  comment?: string;
  secret?: boolean;
}

export interface BuildEnvPlanArgs {
  appType: AppType;
  provider?: ProviderId;
  providerKeys?: Record<string, string>;
  template: Template;
  providerApiKey: string;
  /** Results from a successful General-App creation (undefined otherwise). */
  created?: { appId?: string; clientId?: string; clientSecret?: string };
}

export function buildEnvPlan(args: BuildEnvPlanArgs): EnvEntry[] {
  const { provider, template, providerApiKey, created } = args;
  const entries: EnvEntry[] = [];

  // Each feature declares its actual runtime key and model.
  for (const feature of template.aiFeatures) {
    const p = PROVIDERS[feature.provider];
    if (!entries.some((entry) => entry.key === feature.keyEnv)) {
      entries.push({
        key: feature.keyEnv,
        value: args.providerKeys?.[feature.keyEnv] || (provider === feature.provider ? providerApiKey : '') || '',
        placeholder: p.keyPlaceholder,
        comment: p.label + ' API key',
        secret: true,
      });
    }
    if (!entries.some((entry) => entry.key === feature.modelEnv)) {
      entries.push({ key: feature.modelEnv, value: feature.defaultModel, placeholder: feature.defaultModel });
    }
  }

  // --- Zoom credentials ---
  // General App — the created app's own OAuth credentials (returned once at create time).
  entries.push({
    key: 'ZOOM_APP_ID',
    value: created?.appId || '',
    placeholder: 'created-app-id',
    comment: created?.appId ? 'Filled from the created Marketplace app' : 'Fill after creating the app',
  });
  entries.push({ key: 'ZOOM_CLIENT_ID', value: created?.clientId || '', placeholder: 'app-client-id' });
  entries.push({
    key: 'ZOOM_CLIENT_SECRET',
    value: created?.clientSecret || '',
    placeholder: 'app-client-secret',
    comment: created?.clientSecret
      ? 'Shown once by Zoom at creation — stored here only (never printed)'
      : 'Copy from Marketplace > App Credentials',
    secret: true,
  });

  // --- Template-declared extras (e.g. PORT, ZOOM_BOT_JID) ---
  for (const key of template.requiredEnv) {
    if (entries.some((e) => e.key === key)) continue;
    const defaults: Record<string, { value: string; placeholder: string; comment?: string }> = {
      PORT: { value: '3000', placeholder: '3000', comment: 'Local server port' },
      ZOOM_BOT_JID: { value: '', placeholder: 'xxxxxxxx@xmpp.zoom.us', comment: 'Zoom Chat bot JID (Marketplace > Features > Surface)' },
      ZOOM_WEBHOOK_SECRET_TOKEN: { value: '', placeholder: 'your-webhook-secret-token', comment: 'Webhook Secret Token (Marketplace > Features)' },
    };
    const d = defaults[key] || { value: '', placeholder: `your-${key.toLowerCase()}` };
    entries.push({ key, value: d.value, placeholder: d.placeholder, comment: d.comment });
  }

  return entries;
}

/** True when the template's `zoom dev` flow opens an ngrok tunnel. */
export function templateUsesTunnel(template: Template): boolean {
  return template.runtime?.kind === 'server' || template.runtime?.kind === 'docker';
}

/** Append `KEY=` (empty, with a comment) to a project's .env if the key is absent. For overlay. */
export async function appendEnvVarIfMissing(
  projectDir: string,
  key: string,
  comment: string,
): Promise<boolean> {
  const p = path.join(projectDir, '.env');
  const contents = await fs.readFile(p, 'utf8').catch(() => '');
  if (new RegExp(`^\\s*#?\\s*${key}\\s*=`, 'm').test(contents)) return false;
  // Append as a COMMENTED hint (not an empty assignment) so it's documented without "looking defined"
  // and without shadowing a real value the developer adds. Uncomment and fill to use.
  await fs.appendFile(p, `\n# ${comment}\n# ${key}=\n`);
  return true;
}

function renderEnvFile(entries: EnvEntry[], useRealValues: boolean, header: string): string {
  const lines: string[] = [header, ''];
  for (const e of entries) {
    if (e.comment) lines.push(`# ${e.comment}`);
    const raw = useRealValues ? e.value : e.placeholder;
    const v = /[\s#"']/.test(raw) ? JSON.stringify(raw) : raw;
    lines.push(`${e.key}=${v}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Write .env (real values, 0600) and .env.example (placeholders) into projectDir. */
export async function writeProjectEnv(
  projectDir: string,
  entries: EnvEntry[],
): Promise<{ envPath: string; examplePath: string }> {
  const envPath = path.join(projectDir, '.env');
  const examplePath = path.join(projectDir, '.env.example');

  await fs.writeFile(
    envPath,
    renderEnvFile(entries, true, '# Local environment — DO NOT COMMIT. Generated by create-zoom-agent.'),
    { encoding: 'utf8', mode: 0o600 },
  );
  try {
    await fs.chmod(envPath, 0o600);
  } catch {
    /* best-effort */
  }
  await fs.writeFile(
    examplePath,
    renderEnvFile(entries, false, '# Copy to .env and fill in. Generated by create-zoom-agent.'),
    'utf8',
  );
  return { envPath, examplePath };
}

/** Keys that still need a value (empty in .env) — for the "next steps" summary. */
export function unfilledKeys(entries: EnvEntry[]): string[] {
  return entries.filter((e) => !e.value).map((e) => e.key);
}

/**
 * For reused samples that ship their own `.env.example`: generate `.env` from that example,
 * overwriting only the keys we actually have values for (provider key, Zoom creds, created app id).
 * The sample's curated `.env.example` is left untouched, so its full contract (e.g. Redis, session
 * secret) stays documented. Returns which keys were filled and which known keys were absent.
 */
export async function overlayEnvFromExample(
  projectDir: string,
  values: Record<string, string>,
): Promise<{ envPath: string; filled: string[]; absent: string[] }> {
  const examplePath = path.join(projectDir, '.env.example');
  const example = await fs.readFile(examplePath, 'utf8');
  const filled: string[] = [];
  const present = new Set<string>();

  const out = example.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m || line.trimStart().startsWith('#')) return line;
    const [, indent, key] = m;
    present.add(key);
    const v = values[key];
    if (v) {
      filled.push(key);
      const safe = /[\s#"']/.test(v) ? JSON.stringify(v) : v;
      return `${indent}${key}=${safe}`;
    }
    return line;
  });

  const envPath = path.join(projectDir, '.env');
  await fs.writeFile(envPath, out.join('\n'), { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(envPath, 0o600);
  } catch {
    /* best-effort */
  }
  const absent = Object.keys(values).filter((k) => values[k] && !present.has(k));
  return { envPath, filled, absent };
}

/** Does the scaffolded project ship its own `.env.example`? (sample templates do). */
export async function hasEnvExample(projectDir: string): Promise<boolean> {
  return fs
    .access(path.join(projectDir, '.env.example'))
    .then(() => true)
    .catch(() => false);
}
