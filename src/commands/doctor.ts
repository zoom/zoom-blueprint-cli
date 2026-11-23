// `zoom doctor` — developer diagnostics. Each check reports pass / warn / fail / skip.
//
// Honesty rules: purely local checks never require live credentials; remote checks are SKIPPED
// (not failed) when credentials are absent. A reachable webhook URL is NOT treated as proof that
// Zoom delivered a webhook — we only report what we can actually observe.

import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnv, getZoomCredentials, type ZoomCredentialsResult } from '../config/env.js';
import { findProjectRoot, readProjectState, type ProjectState } from '../config/project-state.js';
import { getTemplate } from '../templates/registry.js';
import { readEnvFile, readEnvValue } from '../config/envfile.js';
import { isPlaceholderValue, validateBotJid, validateSecretToken } from '../config/reconcile.js';
import { loadCanonicalManifest, buildResolvedManifest, localManifestIssues } from '../manifest/project.js';
import { diffManifest } from '../manifest/resolve.js';
import { openMarketplaceSession, type OpenSession } from '../marketplace/session.js';
import { redactSecrets } from '../util/errors.js';
import { log, chalk } from '../util/logger.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface DoctorDeps {
  cwd?: string;
  env?: string;
  openSession?: OpenSession;
  getCreds?: () => ZoomCredentialsResult;
}

/** Run all checks and return them (also used by tests). */
export async function runDoctor(d: DoctorDeps = {}): Promise<CheckResult[]> {
  const cwd = d.cwd ?? process.cwd();
  const env = getEnv(d.env);
  const getCreds = d.getCreds ?? (() => getZoomCredentials());
  const openSession = d.openSession ?? openMarketplaceSession;
  const results: CheckResult[] = [];
  const privateValues = new Set<string>();
  const safe = (text: string): string => {
    let redacted = redactSecrets(text);
    for (const value of privateValues) {
      const escaped = value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const pattern = value.length < 4 ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])` : escaped;
      redacted = redacted.replace(new RegExp(pattern, 'g'), '[REDACTED]');
    }
    return redacted;
  };
  const add = (name: string, status: CheckStatus, detail?: string) => results.push({ name: safe(name), status, detail: detail === undefined ? undefined : safe(detail) });

  // 1. Project configuration exists.
  const root = await findProjectRoot(cwd);
  if (!root) {
    add('Project configuration (.zoom-agent.json)', 'fail', 'Not inside a Zoom agent project.');
    return results;
  }
  add('Project configuration (.zoom-agent.json)', 'pass', root);

  let state: ProjectState;
  try {
    state = await readProjectState(root);
  } catch (err) {
    add('Project configuration readable', 'fail', (err as Error).message);
    return results;
  }

  // 2. Template recognized.
  const template = getTemplate(state.templateId, state.blueprint);
  if (!template) {
    add('Template recognized', 'fail', `Unknown template "${state.templateId}".`);
  } else {
    add('Template recognized', 'pass', template.name);
  }

  // 3. App type compatible with the template.
  if (template) {
    const ok = template.compatibleAppTypes.includes(state.appType);
    add('App type compatible', ok ? 'pass' : 'fail', `${state.appType} vs [${template.compatibleAppTypes.join(', ')}]`);
  }

  // 4. Template manifest files exist.
  if (state.manifestPath) {
    const file = path.join(root, state.manifestPath);
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);
    add('Manifest file present', exists ? 'pass' : 'fail', state.manifestPath);
  } else {
    add('Manifest file present', 'skip', 'template declares no General-App manifest');
  }

  // Required and template-specific checks use the same parsed values and validators as setup.
  const envText = (await readEnvFile(path.join(root, '.env'))) || '';
  const val = (key: string) => readEnvValue(envText, key);
  const required = template?.requiredEnv ?? [];
  const spec = template?.reconcile;
  for (const match of envText.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
    if (/secret|token|password|credential|api[_-]?key/i.test(match[1])) {
      const value = val(match[1]);
      if (value?.trim()) { privateValues.add(value); privateValues.add(encodeURIComponent(value)); }
    }
  }
  for (const feature of template?.aiFeatures ?? []) {
    const key = val(feature.keyEnv) ?? process.env[feature.keyEnv];
    if (key?.trim()) { privateValues.add(key); privateValues.add(encodeURIComponent(key)); }
  }
  const problem = (key: string): string | null => {
    const value = val(key);
    if (isPlaceholderValue(value)) return 'missing or contains a placeholder';
    const prompt = spec?.promptVars?.find(variable => variable.name === key);
    if (prompt?.validate === 'botJid') return validateBotJid(value!);
    if (prompt?.validate === 'secretToken') return validateSecretToken(value!);
    const urlSpec = spec?.urlVars?.find(variable => variable.name === key);
    if (urlSpec) {
      try {
        const url = new URL(value!);
        if (url.protocol !== 'https:' || url.username || url.password) return 'must be a public HTTPS URL without embedded credentials';
        if (urlSpec.kind === 'origin' && (url.pathname !== '/' || url.search || url.hash)) return 'must be an HTTPS origin without a path, query, or fragment';
      } catch { return 'must be a valid public HTTPS URL'; }
    }
    return null;
  };
  const action = (key: string): string => {
    if (spec?.urlVars?.some(variable => variable.name === key)) return 'Run zoom dev to resolve the development URL.';
    if (spec?.generateVars?.some(variable => variable.name === key)) return 'Run zoom dev or zoom configure to generate it.';
    if (spec?.promptVars?.some(variable => variable.name === key)) return 'Run zoom configure for Marketplace setup guidance.';
    if (key === 'ZOOM_CLIENT_ID' || key === 'ZOOM_CLIENT_SECRET') return `Copy the development credential from Marketplace App Credentials into ${key} in the project .env.`;
    return `Set ${key} in the project .env.`;
  };
  if (required.length) {
    const invalid = required.filter(key => problem(key));
    add('Required env vars set', invalid.length ? 'fail' : 'pass', invalid.length ? `Needs attention: ${invalid.join(', ')}.` : 'Configured locally; credential validity has not been verified.');
    for (const key of required) {
      const issue = problem(key);
      add(key, issue ? 'fail' : 'pass', issue ? `${issue}. ${action(key)}` : 'Configured locally; access has not been verified.');
    }
  } else add('Required env vars set', 'skip', 'none declared');

  const devHost = state.lastDevUrl ? hostOf(state.lastDevUrl) : '';
  if (spec) {
    for (const pv of spec.promptVars ?? []) {
      const issue = problem(pv.name);
      add(`${pv.label} configured`, issue ? 'fail' : 'pass', issue ? `${pv.name} ${issue}. ${action(pv.name)}` : 'Passed local checks; live Zoom delivery has not been verified.');
    }
    for (const uv of spec.urlVars ?? []) {
      const value = val(uv.name), issue = problem(uv.name);
      if (issue) {
        const status = isPlaceholderValue(value) && !required.includes(uv.name) ? 'warn' : 'fail';
        add(`${uv.label ?? uv.name} resolved`, status, `${uv.name} ${issue}. ${action(uv.name)}`);
      } else if (devHost && hostOf(value!) !== devHost) {
        add(`${uv.label ?? uv.name} resolved`, 'warn', `${uv.name} host differs from the last dev URL — run zoom dev.`);
      } else add(`${uv.label ?? uv.name} resolved`, 'pass', 'Passed local URL checks; reachability has not been verified.');
    }
    for (const gv of spec.generateVars ?? []) {
      const issue = problem(gv.name);
      add(`${gv.label ?? gv.name} configured`, issue ? (required.includes(gv.name) ? 'fail' : 'warn') : 'pass', issue ? `${gv.name} ${issue}. ${action(gv.name)}` : 'Configured locally.');
    }
    if (spec.appNameVar) {
      const issue = problem(spec.appNameVar.name);
      add(`${spec.appNameVar.label ?? spec.appNameVar.name} configured`, issue ? 'warn' : 'pass', issue ? action(spec.appNameVar.name) : 'Configured locally.');
    }
  }
  // Provider credentials are optional unless the template explicitly requires them.
  for (const feature of template?.aiFeatures ?? []) {
    const key = val(feature.keyEnv) ?? process.env[feature.keyEnv];
    const invalid = isPlaceholderValue(key) || /\s|\.\.\./.test(key ?? '') || (feature.provider === 'anthropic' && !key?.startsWith('sk-ant-'));
    add(feature.name, invalid ? (required.includes(feature.keyEnv) ? 'fail' : 'warn') : 'pass',
      invalid ? `Disabled. Set ${feature.keyEnv} in .env to enable this feature; model variable: ${feature.modelEnv}.` : 'Configured locally; provider access has not been verified.');
  }

  // 6. Manifest passes LOCAL validation (on the CANONICAL manifest — placeholders allowed).
  //    A RESOLVED manifest (for the remote checks) is only built when a dev URL is known.
  let proposed;
  if (state.manifestPath) {
    try {
      const canonical = await loadCanonicalManifest(root, state.manifestPath);
      const issues = localManifestIssues(canonical, state.appType);
      add('Manifest local validation', issues.length ? 'fail' : 'pass', issues.join('; ') || undefined);
      try {
        // Resolves fine for concrete manifests; throws for placeholder manifests with no dev URL.
        proposed = buildResolvedManifest(canonical, {
          baseUrl: state.lastDevUrl,
          urlMappings: template?.runtime?.urlMappings,
        });
      } catch {
        /* unresolved placeholders without a dev URL — remote checks note it below */
      }
    } catch (err) {
      add('Manifest local validation', 'fail', (err as Error).message);
    }
  } else {
    add('Manifest local validation', 'skip');
  }

  // 7-9. Remote checks — only with credentials AND a linked app.
  const creds = getCreds();
  if (!creds.ok) {
    add('Remote Marketplace validation', 'skip', `no credentials (${creds.missing.join(', ')})`);
    add('Remote config matches local', 'skip', 'no credentials');
  } else if (!state.appId) {
    add('Remote Marketplace validation', 'skip', 'project not linked to an app (no appId)');
    add('Remote config matches local', 'skip', 'no appId');
  } else if (!proposed) {
    const why = state.manifestPath ? 'no dev URL yet — run `zoom dev`' : 'no manifest';
    add('Remote Marketplace validation', 'skip', why);
    add('Remote config matches local', 'skip', why);
  } else {
    try {
      const session = await openSession({ env, creds: creds.creds });
      const remote = await session.getManifest(state.appId);
      proposed = buildResolvedManifest(remote, {
        baseUrl: state.lastDevUrl,
        urlMappings: template?.runtime?.urlMappings,
      });
      const validation = await session.validate(proposed, state.appId);
      add(
        'Remote Marketplace validation',
        validation.ok ? 'pass' : 'fail',
        validation.ok ? undefined : validation.issues.map((i) => i.message).join('; '),
      );
      const drift = diffManifest(proposed, remote);
      add(
        'Remote config matches local',
        drift.length === 0 ? 'pass' : 'warn',
        drift.length ? `${drift.length} field(s) differ — run \`zoom app diff\`` : undefined,
      );
    } catch (err) {
      add('Remote Marketplace validation', 'fail', (err as Error).message);
      add('Remote config matches local', 'skip', 'remote unavailable');
    }
  }

  // 10. URL mode and auto-sync configuration
  if (state.urlMode) {
    add('Development URL mode', 'pass', state.urlMode === 'ngrok' ? 'ngrok (automatic tunnel)' : 'custom HTTPS');
  } else {
    add('Development URL mode', 'skip', 'not configured yet — run `zoom dev`');
  }

  if (state.urlMode === 'ngrok') {
    if (state.autoSyncDevUrls === true) {
      add('Auto-sync permission', 'pass', 'enabled — dev URLs sync automatically on ngrok restart');
    } else if (state.autoSyncDevUrls === false) {
      add('Auto-sync permission', 'pass', 'disabled — manual confirmation required');
    } else {
      add('Auto-sync permission', 'skip', 'not set — will be prompted on first ngrok restart');
    }
  }

  // 11. URL synchronization status
  if (state.lastDevUrl && state.syncedDevUrl) {
    if (state.lastDevUrl === state.syncedDevUrl) {
      add('Development URL synced', 'pass', 'current URL matches last synchronized URL');
    } else {
      const lastHost = hostOf(state.lastDevUrl);
      const syncedHost = hostOf(state.syncedDevUrl);
      if (lastHost !== syncedHost) {
        add(
          'Development URL synced',
          'warn',
          `URL changed (${syncedHost} → ${lastHost}) — run \`zoom dev\` to sync`
        );
      }
    }
  } else if (state.lastDevUrl) {
    add('Development URL synced', 'warn', 'dev URL known but never synchronized — run `zoom dev`');
  }

  // 12. Dev server / tunnel — only meaningful while `zoom dev` runs.
  add('Dev server reachable', 'skip', 'run `zoom dev` to start it');
  const hasNgrokToken = !!process.env.NGROK_AUTHTOKEN;
  if (state.urlMode === 'ngrok' || !state.urlMode) {
    add('ngrok tunnel connected', 'skip', hasNgrokToken ? 'authtoken set; start with `zoom dev`' : 'NGROK_AUTHTOKEN not set');
  }

  // 13. Live Zoom webhook delivery — cannot be proven locally; a reachable route is NOT proof.
  if (template?.supportedSurfaces.includes('team_chat')) {
    add('Zoom webhook delivery', 'skip', 'send menu in Zoom Chat and confirm a signed webhook and bot reply');
  }
  if (template?.supportedSurfaces.includes('contact_center')) {
    add('Contact Center engagement', 'skip', 'authorize from the public URL, assign the app to a queue, and test it during an engagement');
  }

  return results;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const SYMBOL: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✖', skip: '·' };
function colorize(status: CheckStatus, text: string): string {
  if (status === 'pass') return chalk.green(text);
  if (status === 'warn') return chalk.yellow(text);
  if (status === 'fail') return chalk.red(text);
  return chalk.dim(text);
}

/** CLI entry: run checks, print a report, return an exit code (nonzero if any check failed). */
export async function doctor(d: DoctorDeps = {}): Promise<number> {
  const results = await runDoctor(d);
  log.heading('zoom doctor');
  for (const r of results) {
    const line = `${SYMBOL[r.status]} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`;
    log.plain('  ' + colorize(r.status, line));
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  log.plain('');
  if (failed) log.error(`${failed} check(s) failed, ${warned} warning(s).`);
  else if (warned) log.warn(`All critical checks passed, ${warned} warning(s).`);
  else log.success('All checks passed.');
  return failed ? 1 : 0;
}
