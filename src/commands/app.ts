// Link and manage the Marketplace manifest for a scaffolded project.
// Sync starts from the remote manifest because Zoom replaces it on update.

import { urlRows, renderUrlVerification, renderUrls, type UrlRow } from '../util/urls.js';
import { marketplaceFailure, printMarketplaceFailure } from '../util/marketplace-status.js';
import { confirm as inquirerConfirm } from '@inquirer/prompts';
import { getEnv, getZoomCredentials, marketplaceAppUrl, type ZoomCredentialsResult } from '../config/env.js';
import { loadProjectState, readProjectState, updateProjectState } from '../config/project-state.js';
import { getTemplate } from '../templates/registry.js';
import { loadCanonicalManifest, buildResolvedManifest, localManifestIssues } from '../manifest/project.js';
import { diffManifest, innerManifest, getPath } from '../manifest/resolve.js';
import { openMarketplaceSession, type OpenSession } from '../marketplace/session.js';
import { CliError, formatError } from '../util/errors.js';
import { log, renderDiff, renderMarketplaceHelp } from '../util/logger.js';

export interface AppCommandDeps {
  cwd?: string;
  env?: string;
  openSession?: OpenSession;
  getCreds?: () => ZoomCredentialsResult;
  confirm?: (message: string) => Promise<boolean>;
  chooseSync?: (rows: UrlRow[], signal?: AbortSignal) => Promise<boolean>;
}

export interface AppCommandOpts {
  /** Public base URL to resolve the manifest's dev URL fields against. */
  url?: string;
  /** Skip the sync confirmation prompt. */
  yes?: boolean;
}

function deps(d: AppCommandDeps = {}) {
  return {
    cwd: d.cwd ?? process.cwd(),
    chooseSync: d.chooseSync,
    env: getEnv(d.env),
    openSession: d.openSession ?? openMarketplaceSession,
    getCreds: d.getCreds ?? (() => getZoomCredentials()),
    confirm: d.confirm ?? ((message: string) => inquirerConfirm({ message, default: false })),
  };
}

// zoom app link
export async function appLink(appId: string, d: AppCommandDeps = {}): Promise<number> {
  const id = appId.trim();
  if (!id || /\s/.test(id)) throw new CliError('Provide a Marketplace app ID with --app-id.');

  const { dir, state } = await loadProjectState(d.cwd);
  const ctx = deps({ ...d, env: d.env ?? state.env });
  if (state.appType !== 'general' || !state.manifestPath) {
    throw new CliError('Link requires a General App project with a manifest.');
  }
  if (state.env && ctx.env.name !== state.env) {
    throw new CliError(`This project targets Zoom ${state.env}. Link an app in that environment.`);
  }
  if (state.appId && state.appId !== id) {
    throw new CliError(`This project is already linked to Marketplace app ${state.appId}.`);
  }

  const creds = ctx.getCreds();
  if (!creds.ok) {
    throw new CliError(`Zoom management credentials required — missing ${creds.missing.join(', ')}.`);
  }

  try {
    const session = await ctx.openSession({ env: ctx.env, creds: creds.creds });
    await session.getManifest(id);
    const current = await readProjectState(dir);
    if (current.appId && current.appId !== id) {
      throw new CliError(`This project is already linked to Marketplace app ${current.appId}.`);
    }
    if (!current.appId) await updateProjectState(dir, { appId: id });
    log.success(`Linked ${state.projectName} to Zoom Marketplace app ${id}.`);
    log.plain();
    log.plain(renderMarketplaceHelp('Open Marketplace app\n    ' + marketplaceAppUrl(ctx.env, id)));
    log.plain();
    log.dim('  Run `zoom app diff --url <https-url>` to preview configuration changes.');
    return 0;
  } catch (err) {
    log.plain(formatError(err, 'Link'));
    return 1;
  }
}

// zoom app validate
export async function appValidate(opts: AppCommandOpts = {}, d: AppCommandDeps = {}): Promise<number> {
  const ctx = deps(d);
  const { dir, state } = await loadProjectState(ctx.cwd);
  const template = getTemplate(state.templateId, state.blueprint);
  log.heading(`Validate — ${state.projectName}`);

  if (!state.manifestPath) {
    log.warn('This template has no General-App manifest to validate.');
    return 0;
  }

  const canonical = await loadCanonicalManifest(dir, state.manifestPath);
  // --- Local structural validation runs on the CANONICAL manifest (placeholders are allowed) ---
  const local = localManifestIssues(canonical, state.appType);
  if (local.length) {
    log.error('Local validation FAILED:');
    for (const i of local) log.plain('  - ' + i);
    return 1;
  }
  log.success('Local structural validation passed.');

  // --- Remote Marketplace validation (only with credentials + a resolvable manifest) ---
  const creds = ctx.getCreds();
  if (!creds.ok) {
    log.warn(`Remote Marketplace validation SKIPPED — missing ${creds.missing.join(', ')}.`);
    log.dim('  This is a LOCAL-ONLY pass. Run zoom login to validate against Zoom.');
    return 0;
  }
  let manifest;
  try {
    manifest = buildResolvedManifest(canonical, {
      baseUrl: opts.url || state.lastDevUrl,
      urlMappings: template?.runtime?.urlMappings,
    });
  } catch {
    log.warn('Remote validation SKIPPED — the manifest still has unresolved dev URL placeholders.');
    log.dim('  Pass --url <https-url> or run `zoom dev` (which resolves the live ngrok URL).');
    return 0;
  }
  try {
    const session = await ctx.openSession({ env: ctx.env, creds: creds.creds });
    const result = await session.validate(manifest, state.appId);
    if (!result.ok) {
      log.error('Remote Marketplace validation FAILED:');
      for (const issue of result.issues) log.plain(`  - ${issue.setting ? issue.setting + ': ' : ''}${issue.message}`);
      return 1;
    }
    log.success('Remote Marketplace validation passed.');
    return 0;
  } catch (err) {
    log.error('Remote validation could not complete:');
    log.plain(formatError(err, 'Validate'));
    return 1;
  }
}

// zoom app diff
export async function appDiff(opts: AppCommandOpts = {}, d: AppCommandDeps = {}): Promise<number> {
  const { dir, state } = await loadProjectState(d.cwd);
  const ctx = deps({ ...d, env: d.env ?? state.env });
  const template = getTemplate(state.templateId, state.blueprint);
  log.heading(`Diff — ${state.projectName}`);

  const guard = requireLinkedApp(state, ctx.getCreds());
  if (guard) return guard;

  await loadCanonicalManifest(dir, state.manifestPath!);
  try {
    const session = await ctx.openSession({ env: ctx.env, creds: ctx.getCreds().creds });
    const remote = await session.getManifest(state.appId!);
    const proposed = buildResolvedManifest(remote, {
      baseUrl: opts.url || state.lastDevUrl,
      urlMappings: template?.runtime?.urlMappings,
    });
    const entries = diffManifest(proposed, remote);
    printDiff(entries);
    return 0;
  } catch (err) {
    log.plain(formatError(err, 'Diff'));
    return 1;
  }
}

// zoom app sync
export async function appSync(opts: AppCommandOpts = {}, d: AppCommandDeps = {}): Promise<number> {
  const ctx = deps(d);
  const { dir, state } = await loadProjectState(ctx.cwd);
  const template = getTemplate(state.templateId, state.blueprint);
  log.heading(`Sync — ${state.projectName}`);

  const guard = requireLinkedApp(state, ctx.getCreds());
  if (guard) return guard;

  await loadCanonicalManifest(dir, state.manifestPath!);

  try {
    const session = await ctx.openSession({ env: ctx.env, creds: ctx.getCreds().creds });

    // 1. Fetch + preserve the current remote manifest.
    const remote = await session.getManifest(state.appId!);

    // 2. Apply ONLY our project/env changes on top of the remote (full-replace safe).
    const proposed = buildResolvedManifest(remote, {
      baseUrl: opts.url || state.lastDevUrl,
      urlMappings: template?.runtime?.urlMappings,
    });

    // 3. Diff; nothing to do if already in sync.
    const entries = diffManifest(proposed, remote);
    if (entries.length === 0) {
      await updateProjectState(dir, { marketplaceFailure: undefined });
      log.success('Remote configuration is already in sync. Nothing to apply.');
      log.plain('  Keep zoom dev running. Return to Zoom to test your app.');
      return 0;
    }
    log.heading(`Marketplace · ${entries.length} URL change${entries.length === 1 ? '' : 's'}`);
    const comparison = urlRows(remote, proposed, template?.runtime?.urlMappings ?? []);
    for (const line of renderUrls(comparison.filter(row => row.current !== row.proposed))) log.plain(line);

    // 4. Validate the proposed manifest before applying.
    const validation = await session.validate(proposed, state.appId!);
    if (!validation.ok) {
      const failure = marketplaceFailure('sync', { message: 'Zoom rejected the manifest', issues: validation.issues });
      await updateProjectState(dir, { marketplaceFailure: failure });
      printMarketplaceFailure(state, failure);
      return 1;
    }

    // 5. Explicit confirmation.
    if (!opts.yes) {
      const rows = urlRows(remote, proposed, template?.runtime?.urlMappings ?? []);
      const ok = ctx.chooseSync ? await ctx.chooseSync(rows) : await ctx.confirm('Apply these changes to the Zoom Marketplace app?');
      if (!ok) {
        log.warn('Cancelled — no changes applied.');
        return 0;
      }
    }

    // 6. Apply (full replace). Never auto-retried on ambiguous failure.
    await session.updateManifest(state.appId!, proposed);
    log.plain('  Update request accepted. Reading the manifest back from Zoom…');

    // 7. Re-fetch and verify the changed fields landed.
    const after = await session.getManifest(state.appId!);
    const mappings = template?.runtime?.urlMappings ?? [];
    const drift = mappings.filter((m) => getPath(innerManifest(after), m.path) !== getPath(innerManifest(proposed), m.path));
    if (drift.length) {
      log.warn('Marketplace synchronization could not be verified.');
      for (const line of renderUrlVerification(after, proposed, drift)) log.plain(line);
      log.dim('  Run `zoom app diff` to inspect the current remote state.');
      return 1;
    }
    await updateProjectState(dir, { marketplaceFailure: undefined });
    for (const mapping of mappings) log.success(`${mapping.label || mapping.path} verified`);
    log.success('Verified: remote configuration matches the intended changes.');
    log.plain('  Keep zoom dev running. Return to Zoom to test your app.');
    return 0;
  } catch (err) {
    log.error('Sync did not complete safely:');
    const failure = marketplaceFailure('sync', err);
    await updateProjectState(dir, { marketplaceFailure: failure });
    printMarketplaceFailure(state, failure);
    log.dim('  The update is not auto-retried. Run `zoom app diff` to confirm the current remote state before retrying.');
    return 1;
  }
}

// ---- helpers ----------------------------------------------------------------

function requireLinkedApp(
  state: { appId?: string; manifestPath?: string },
  creds: ZoomCredentialsResult,
): number | null {
  if (!state.manifestPath) {
    log.warn('This project has no General-App manifest (nothing to compare).');
    return 0;
  }
  if (!state.appId) {
    log.error('This project is not linked to a Marketplace app (no appId in .zoom-agent.json).');
    log.dim('  Run `zoom app create` to create an app, or `zoom app link --app-id <id>` to link an existing app.');
    return 1;
  }
  if (!creds.ok) {
    log.error(`Zoom credentials required to reach the Marketplace — missing ${creds.missing.join(', ')}.`);
    return 1;
  }
  return null;
}

function printDiff(entries: ReturnType<typeof diffManifest>): void {
  if (entries.length === 0) {
    log.dim('  (no differences)');
    return;
  }
  log.plain(`  Proposed (local) vs current (remote) — ${entries.length} field${entries.length === 1 ? '' : 's'}:`);
  log.plain('');
  for (const line of renderDiff(entries)) log.plain(line);
}
