import { warnUnverifiedNode } from '../util/node-version.js';
// `zoom dev` — the unified local development command: load config → start the dev server → start
// ngrok → resolve the public URL into the template's manifest URL fields → validate → diff vs
// remote → (confirm) sync → keep running until Ctrl+C.
//
// Fully dependency-injected so the orchestration is unit-testable without real child processes, a
// real ngrok tunnel, or the network. The real implementations live in dev-runtime.ts.
//
// Honesty: a ✓ is printed ONLY for operations that actually succeeded. If ngrok is not configured,
// we do NOT claim a tunnel started. If sync is skipped/declined, we report that Zoom callbacks are
// not yet pointed at this tunnel.

import fs from 'node:fs/promises';
import { marketplaceFailure, readMarketplaceFailure, printMarketplaceFailure } from '../util/marketplace-status.js';
import path from 'node:path';
import { renderUrlVerification, renderUrls, urlRows, type UrlRow } from '../util/urls.js';
import { select } from '@inquirer/prompts';
import { getEnv, getZoomCredentials, marketplaceAppUrl, type ZoomCredentialsResult } from '../config/env.js';
import { loadProjectState, updateProjectState } from '../config/project-state.js';
import { getTemplate } from '../templates/registry.js';
import { buildResolvedManifest, readProjectPort } from '../manifest/project.js';
import { PROVIDERS } from '../providers.js';
import { isPlaceholderValue } from '../config/reconcile.js';
import { readDotenvFile } from '../config/dotenv.js';
import { diffManifest, innerManifest, getPath } from '../manifest/resolve.js';
import { openMarketplaceSession, type OpenSession } from '../marketplace/session.js';
import { reconcileProject, printReconcileReport } from './configure.js';
import type { ReconcileResult } from '../config/reconcile.js';
import { formatError, CliError, isCancel } from '../util/errors.js';
import { log, chalk, renderMarketplaceHelp, zoomTheme } from '../util/logger.js';

export interface DevTunnel {
  url: string;
  close(): Promise<void>;
}
export interface DevServerHandle {
  stop(): Promise<void>;
  logFile?: string;
  signal?: AbortSignal;
  exited?: Promise<Error>;
  releaseOutput?(): void;
}

export interface DevDeps {
  cwd?: string;
  env?: string;
  signal?: AbortSignal;
  getCreds?: () => ZoomCredentialsResult;
  hasNgrokToken?: () => boolean;
  startServer?: (opts: { cwd: string; command: string[]; port: number; portEnv?: string; env?: Record<string, string>; verbose?: boolean }) => Promise<DevServerHandle>;
  waitForReady?: (opts: { port: number; path?: string; signal?: AbortSignal }) => Promise<boolean>;
  startTunnel?: (opts: { port: number }) => Promise<DevTunnel>;
  /** Check the PUBLIC health endpoint (full URL). Returns true on a 2xx. */
  checkHealth?: (url: string) => Promise<boolean>;
  openSession?: OpenSession;
  /** Reconcile the project .env against the active dev URL + app metadata (default: real engine). */
  reconcile?: (args: {
    dir: string;
    state: Awaited<ReturnType<typeof loadProjectState>>['state'];
    template: ReturnType<typeof getTemplate>;
    baseUrl?: string;
    env: ReturnType<typeof getEnv>;
    creds: ZoomCredentialsResult;
    openSession: OpenSession;
    interactive: boolean;
  }) => Promise<ReconcileResult>;
  chooseSync?: (rows: UrlRow[], signal?: AbortSignal) => Promise<boolean>;
  confirm?: (message: string, signal?: AbortSignal) => Promise<boolean>;
  /** Blocks until the developer stops the process (SIGINT). In tests, resolves immediately. */
  waitForShutdown?: (signal?: AbortSignal) => Promise<void>;
}

export interface DevOpts {
  yes?: boolean;
  verbose?: boolean;
  noSync?: boolean;
  port?: number;
  /** Custom HTTPS URL to use instead of ngrok. */
  url?: string;
}

type SyncOutcome = 'synced' | 'already-synced' | 'skipped-no-creds' | 'skipped-flag' | 'declined' | 'invalid' | 'failed' | 'n/a';
type UrlMode = 'ngrok' | 'custom';

/** Validate a custom HTTPS URL for development use. */
function validateCustomUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return 'Must be an HTTPS URL (not http://)';
    if (!parsed.hostname) return 'Invalid URL: missing hostname';
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return 'localhost is not reachable from Zoom — use a tunnel or public hostname';
    }
    return null; // valid
  } catch {
    return 'Invalid URL format';
  }
}

/** Prompt user to choose between ngrok and custom URL (when not specified via --url flag). */
async function promptUrlMode(hasNgrokToken: boolean, signal?: AbortSignal): Promise<UrlMode> {
  if (!hasNgrokToken) {
    log.warn('NGROK_AUTHTOKEN not set — you must provide your own HTTPS URL.');
    return 'custom';
  }
  log.plain();
  const choice = await select({
    message: 'Choose your development URL:',
    theme: zoomTheme,
    choices: [
      { name: 'Use ngrok (automatic tunnel)', value: 'ngrok' },
      { name: 'Use my own HTTPS URL', value: 'custom' },
    ],
  }, { signal });
  log.plain();
  return choice as UrlMode;
}

/** Check if a URL hostname changed (for detecting ngrok restarts). */
function urlHostnameChanged(url1: string | undefined, url2: string | undefined): boolean {
  if (!url1 || !url2) return false;
  try {
    const h1 = new URL(url1).hostname;
    const h2 = new URL(url2).hostname;
    return h1 !== h2;
  } catch {
    return false;
  }
}

export async function dev(opts: DevOpts = {}, d: DevDeps = {}): Promise<number> {
  warnUnverifiedNode();
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Development stopped'));
  const forward = () => controller.abort(d.signal?.reason);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  d.signal?.addEventListener('abort', forward, { once: true });
  if (d.signal?.aborted) forward();
  try { return await runDev(opts, { ...d, signal: controller.signal }); }
  finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    d.signal?.removeEventListener('abort', forward);
    log.plain();
  }
}

async function runDev(opts: DevOpts, d: DevDeps): Promise<number> {
  const cwd = d.cwd ?? process.cwd();
  const getCreds = d.getCreds ?? (() => getZoomCredentials());
  const hasNgrokToken = d.hasNgrokToken ?? (() => !!process.env.NGROK_AUTHTOKEN);
  const openSession = d.openSession ?? openMarketplaceSession;
  const reconcile = d.reconcile ?? ((a) => reconcileProject({ ...a, deps: { signal: d.signal } }));
  const confirm = d.confirm ?? (async () => false);
  const waitForShutdown = d.waitForShutdown ?? (async () => {});

  const { dir, state } = await loadProjectState(cwd);
  const env = getEnv(d.env ?? state.env);
  const template = getTemplate(state.templateId, state.blueprint);
  const runtime = template?.runtime;

  log.header(state.projectName);
  log.plain(`  Template: ${template?.name ?? state.templateId}`);
  if (opts.verbose) log.plain(`  App type: General App`);
  log.plain('');
  if (opts.verbose) log.success('Local configuration loaded');
  const previousFailure = await readMarketplaceFailure(dir, state);
  if (state.appType === 'general' && (!state.appId || previousFailure)) {
    printMarketplaceFailure(state, previousFailure);
    log.dim('  Continuing local development; Marketplace setup is still required.');
  }

  if (!runtime) {
    log.warn('This template declares no dev runtime. Start it manually from its README.');
    return 0;
  }
  if (runtime.kind === 'batch') {
    log.warn('This is a batch job — there is no server to tunnel.');
    log.dim(`  Run it with:  ${runtime.devCommand.join(' ')}`);
    return 0;
  }

  const port = opts.port ?? (await readProjectPort(dir, runtime.portEnv, runtime.defaultPort ?? 3000));

  // --- docker templates: we provide a stable tunnel + instructions, not full lifecycle management.
  if (runtime.kind === 'docker') {
    return devDocker({ dir, state, port, runtime, hasNgrokToken, startTunnel: d.startTunnel, waitForShutdown });
  }

  // --- server templates: full lifecycle ---
  // Validate dependencies BEFORE starting, so a crash like "Cannot find package 'express'" becomes a
  // clear "run npm install first" instead of a misleading readiness result.
  const missingDependencies = await findMissingDependencies(dir, runtime.dependencyDirs);
  if (missingDependencies.length) {
    log.error('Application dependencies are incomplete.');
    for (const missing of missingDependencies) {
      log.plain(`  ${missing.directory === '.' ? 'root' : missing.directory}: missing ${missing.packages.join(', ')}`);
    }
    log.plain();
    log.dim(`  Run:  ${template?.setupCommands?.join(' && ') || 'npm install'}`);
    log.dim('  then `zoom dev` again.');
    return 1;
  }

  let server: DevServerHandle | undefined;
  let tunnel: DevTunnel | undefined;
  const runtimeController = new AbortController();
  const stopRuntime = () => runtimeController.abort(d.signal?.reason);
  d.signal?.addEventListener('abort', stopRuntime, { once: true });
  if (d.signal?.aborted) stopRuntime();
  const signal = runtimeController.signal;
  const alive = async <T>(work: Promise<T>): Promise<T> => {
    if (signal.aborted) throw signal.reason;
    let listener: () => void = () => {};
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener('abort', listener, { once: true });
      })]);
    } finally { signal.removeEventListener('abort', listener); }
  };
  let developmentUrl: string;
  let urlMode: UrlMode;

  try {
    signal.throwIfAborted();
    // 1. Determine URL mode and get the development URL
    if (opts.url) {
      // Custom URL provided via --url flag
      const err = validateCustomUrl(opts.url);
      if (err) throw new CliError(`Invalid --url: ${err}`);
      developmentUrl = opts.url.replace(/\/+$/, ''); // normalize trailing slash
      urlMode = 'custom';
      log.success(`Using custom HTTPS URL: ${developmentUrl}`);
      if (opts.verbose) log.dim('  Skipping ngrok tunnel (custom URL provided).');
    } else if (opts.yes || !process.stdin.isTTY || !hasNgrokToken() || d.cwd) {
      // Non-interactive, no ngrok token, or test/mock environment: default to ngrok
      if (!hasNgrokToken()) {
        log.error('ngrok is not configured — cannot establish an HTTPS tunnel.');
        log.dim('  Set NGROK_AUTHTOKEN (free at https://dashboard.ngrok.com) in your environment, or pass --url <https-url>.');
        log.dim('  export NGROK_AUTHTOKEN=...');
        return 1;
      }
      // Start ngrok
      urlMode = 'ngrok';
      if (!d.startTunnel) throw new Error('startTunnel dependency is required');
      tunnel = await d.startTunnel({ port });
      developmentUrl = tunnel.url;
      log.success('ngrok tunnel established');
      if (opts.verbose) log.success(`HTTPS URL resolved: ${developmentUrl}`);
    } else {
      // Interactive: prompt for URL mode
      urlMode = await promptUrlMode(hasNgrokToken(), signal);
      if (urlMode === 'ngrok') {
        if (!d.startTunnel) throw new Error('startTunnel dependency is required');
        tunnel = await d.startTunnel({ port });
        developmentUrl = tunnel.url;
        log.success('ngrok tunnel established');
        if (opts.verbose) log.success(`HTTPS URL resolved: ${developmentUrl}`);
      } else {
        // Prompt for custom URL
        const { input } = await import('@inquirer/prompts');
        let customUrl: string = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          customUrl = (await input({ message: 'Enter your HTTPS URL (e.g., https://dev.example.com):' }, { signal })).trim();
          const err = validateCustomUrl(customUrl);
          if (!err) break;
          log.error(`  ${err}`);
          if (attempt === 2) throw new CliError('Invalid custom URL after 3 attempts.');
        }
        developmentUrl = customUrl.replace(/\/+$/, '');
        log.success(`Using custom HTTPS URL: ${developmentUrl}`);
      }
    }

    signal.throwIfAborted();
    // Persist the non-secret dev URL and mode (enables change detection next session).
    await updateProjectState(dir, { lastDevUrl: developmentUrl, urlMode });

    // 2. Reconcile the project .env against the live URL + app metadata, BEFORE the server starts.
    let runtimeEnv: Record<string, string> | undefined;
    if (template?.reconcile) {
      log.plain('');
      if (opts.verbose) log.step('Reconciling local environment');
      const rec = await alive(reconcile({
        dir,
        state,
        template,
        baseUrl: developmentUrl,
        env,
        creds: getCreds(),
        openSession,
        interactive: !opts.yes && !!process.stdin.isTTY,
      }));
      printReconcileReport(rec, !!opts.verbose);
      log.plain('');
      // Re-read the just-written .env and pass it to the child, overriding any stale inherited values.
      runtimeEnv = readDotenvFile(path.join(dir, '.env')) ?? undefined;
    }

    signal.throwIfAborted();
    // 3. Start the dev server (with the reconciled runtime config).
    if (!d.startServer) throw new Error('startServer dependency is required');
    server = await d.startServer({ cwd: dir, command: runtime.devCommand, port, portEnv: runtime.portEnv, env: runtimeEnv, verbose: opts.verbose });
    server.signal?.addEventListener('abort', () => runtimeController.abort(server!.signal!.reason), { once: true });
    if (server.signal?.aborted) runtimeController.abort(server.signal.reason);
    if (server.logFile) log.dim(`  Runtime log: ${server.logFile}`);
    log.success('Development server started');

    // 4. Readiness.
    signal.throwIfAborted();
    const ready = d.waitForReady ? await alive(d.waitForReady({ port, path: runtime.readinessPath, signal })) : true;
    if (!ready) {
      log.error(`Development server did not become ready on port ${port}${runtime.readinessPath ?? ''}.`);
      log.dim(`  Check ${server.logFile || 'the application logs'} for startup errors.`);
      return 1;
    }
    if (opts.verbose) log.success(`Development server ready on http://localhost:${port}`);

    // 5. Detect URL change and handle auto-sync permission (ngrok only).
    const urlChanged = urlHostnameChanged(state.lastDevUrl, developmentUrl);
    const autoSync = state.autoSyncDevUrls;
    // Existing opt-in is honored only for known development hosts; new sessions use the action menu.
    const shouldAutoConfirm = urlChanged && urlMode === 'ngrok' && autoSync === true;
    const syncOpts = { ...opts, yes: opts.yes || shouldAutoConfirm };

    // 6. Manifest resolve + validate + diff + sync action.

    if (shouldAutoConfirm && !opts.noSync) {
      log.dim('  Auto-syncing development URLs (permission granted previously).');
    }

    const sync = await alive(syncManifest({
      dir,
      state,
      template,
      baseUrl: developmentUrl,
      opts: syncOpts,
      env,
      getCreds,
      openSession,
      confirm,
      signal,
      chooseSync: d.chooseSync,
      autoApproved: shouldAutoConfirm && !opts.yes,
    }));
    if (sync === 'synced' || sync === 'already-synced') {
      await updateProjectState(dir, { syncedDevUrl: developmentUrl });
    }

    signal.throwIfAborted();
    // 7. Public health check (only meaningful after the tunnel + server are up).
    let healthOk: boolean | undefined;
    if (d.checkHealth && runtime.readinessPath) {
      healthOk = await d.checkHealth(`${developmentUrl.replace(/\/+$/, '')}${runtime.readinessPath}`);
      if (healthOk) log.success('Public endpoint reachable');
      else log.warn('Public health endpoint did not respond 2xx (the URL is configured; check server/network)');
    }

    // 8. Summary.
    printDevSummary({ port, url: developmentUrl, runtime, sync, healthOk, urlMode, verbose: opts.verbose });
    if (state.appId) {
      log.plain();
      log.plain('  ' + renderMarketplaceHelp('Open Marketplace app\n    ' + marketplaceAppUrl(env, state.appId)));
    }
    const projectEnv = runtimeEnv ?? readDotenvFile(path.join(dir, '.env')) ?? {};
    const reportedKeys = new Set<string>();
    for (const feature of template?.aiFeatures ?? []) {
      const key = projectEnv[feature.keyEnv] ?? process.env[feature.keyEnv];
      if (isPlaceholderValue(key) || (feature.provider === 'anthropic' && !key?.startsWith('sk-ant-'))) {
        if (reportedKeys.has(feature.keyEnv)) continue;
        reportedKeys.add(feature.keyEnv);
        const features = template!.aiFeatures.filter(item => item.keyEnv === feature.keyEnv);
        const label = features.length === 1 ? feature.name : PROVIDERS[feature.provider].label + ' features';
        log.warn(`${label} disabled. Set ${feature.keyEnv} in .env and restart to enable ${features.length === 1 ? 'it' : 'them'}.`);
        if (opts.verbose) log.dim('  Affected: ' + features.map(item => item.name).join('; '));
      }
    }

    // 9. Keep running until Ctrl+C.
    log.plain('');
    log.dim('Press Ctrl+C to stop the server and tunnel.');
    server.releaseOutput?.();
    await alive(waitForShutdown(d.signal));
    return 0;
  } catch (err) {
    if (d.signal?.aborted || isCancel(err)) { log.warn('Development stopped.'); return 130; }
    log.error('Development stopped unexpectedly:');
    log.plain(formatError(err, 'dev'));
    log.dim('  Inspect the runtime log, resolve the reported error, then run zoom dev again.');
    return 1;
  } finally {
    d.signal?.removeEventListener('abort', stopRuntime);
    // Clean up both, always.
    if (tunnel) await tunnel.close().catch(error => {
      log.warn('Tunnel cleanup did not complete.');
      log.plain(formatError(error, 'tunnel cleanup'));
    });
    if (server) await server.stop().catch(error => {
      log.warn('Development server cleanup did not complete.');
      log.plain(formatError(error, 'server cleanup'));
    });
  }
}

/** Check the sample's direct runtime and development dependencies before opening a tunnel. */
async function findMissingDependencies(dir: string, directories = ['.']): Promise<{ directory: string; packages: string[] }[]> {
  // Some injectable runtimes have no package.json; their caller owns dependency setup.
  try { await fs.access(path.join(dir, 'package.json')); } catch { return []; }
  const missing: { directory: string; packages: string[] }[] = [];
  for (const directory of directories) {
    const packageDir = path.join(dir, directory);
    let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    try { pkg = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8')); }
    catch { missing.push({ directory, packages: ['package.json'] }); continue; }
    const packages: string[] = [];
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      try { await fs.access(path.join(packageDir, 'node_modules', name, 'package.json')); }
      catch { packages.push(name); }
    }
    if (packages.length) missing.push({ directory, packages });
  }
  return missing;
}

interface SyncArgs {
  dir: string;
  state: Awaited<ReturnType<typeof loadProjectState>>['state'];
  template: ReturnType<typeof getTemplate>;
  baseUrl: string;
  opts: DevOpts;
  env: ReturnType<typeof getEnv>;
  getCreds: () => ZoomCredentialsResult;
  openSession: OpenSession;
  confirm: (m: string, signal?: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal;
  chooseSync?: (rows: UrlRow[], signal?: AbortSignal) => Promise<boolean>;
  autoApproved?: boolean;
}

async function syncManifest(a: SyncArgs): Promise<SyncOutcome> {
  const { dir, state, template, baseUrl, opts, env, getCreds, openSession, confirm, signal } = a;
  const mappings = template?.runtime?.urlMappings ?? [];

  if (!state.manifestPath || state.marketplaceSetup === 'manual') {
    log.dim('  Manifest sync not applicable to this template (manual / no General-App manifest).');
    return 'n/a';
  }
  if (opts.noSync) {
    log.warn('Manifest sync skipped (--no-sync).');
    return 'skipped-flag';
  }
  const creds = getCreds();
  if (!creds.ok || !state.appId) {
    log.warn(
      `Manifest sync skipped — ${!state.appId ? 'project not linked to an app' : `missing ${creds.missing.join(', ')}`}.`,
    );
    return 'skipped-no-creds';
  }

  try {
    const session = await openSession({ env, creds: creds.creds });
    const remote = await session.getManifest(state.appId);
    signal?.throwIfAborted();
    const proposed = buildResolvedManifest(remote, { baseUrl, urlMappings: mappings });
    if (opts.verbose) log.success('Development manifest generated');

    const entries = diffManifest(proposed, remote);
    if (entries.length === 0) {
      await updateProjectState(dir, { marketplaceFailure: undefined });
      log.success('Remote configuration already matches this tunnel');
      return 'already-synced';
    }

    const validation = await session.validate(proposed, state.appId);
    signal?.throwIfAborted();
    if (!validation.ok) {
      const failure = marketplaceFailure('sync', { message: 'Zoom rejected the development manifest', issues: validation.issues });
      await updateProjectState(dir, { marketplaceFailure: failure });
      printMarketplaceFailure(state, failure);
      return 'invalid';
    }
    if (opts.verbose) log.success('Manifest validated');

    log.heading(`Marketplace · ${entries.length} URL change${entries.length === 1 ? '' : 's'}`);
    log.plain('');
    const rows = urlRows(remote, proposed, mappings);
    for (const line of renderUrls(rows.filter(row => row.current !== row.proposed))) log.plain(line);
    log.plain('');

    // A previous auto-sync grant only covers the previous development host, not unrelated custom endpoints.
    const knownHosts = new Set([state.lastDevUrl, baseUrl, 'https://example.ngrok.app'].filter(Boolean).map(value => new URL(value!).hostname));
    const customChanges = rows.filter(row => row.current !== row.proposed && row.current !== '(unset)').some(row => {
      try { return !knownHosts.has(new URL(row.current).hostname); }
      catch { return !knownHosts.has(row.current); }
    });
    const autoApply = opts.yes && !(a.autoApproved && customChanges);
    if (a.autoApproved && customChanges) log.warn('Custom Marketplace endpoints will change. Review and approve these explicitly.');
    const ok = autoApply ? true : a.chooseSync
      ? await a.chooseSync(rows, signal)
      : await confirm('Synchronize the Zoom app configuration with this tunnel URL?', signal);
    if (!ok) {
      log.warn('Sync skipped — Marketplace URLs are unchanged.');
      return 'declined';
    }

    signal?.throwIfAborted();
    await session.updateManifest(state.appId, proposed);
    log.plain('  Update request accepted. Reading the manifest back from Zoom…');
    const after = await session.getManifest(state.appId);
    signal?.throwIfAborted();
    const drift = mappings.filter((m) => getPath(innerManifest(after), m.path) !== getPath(innerManifest(proposed), m.path));
    if (drift.length) {
      log.warn('Marketplace synchronization could not be verified.');
      for (const line of renderUrlVerification(after, proposed, drift)) log.plain(line);
      log.dim('  Run `zoom app diff` to inspect the remote state. No update is automatically retried.');
      return 'failed';
    }
    await updateProjectState(dir, { marketplaceFailure: undefined });
    for (const mapping of mappings) log.success(`${mapping.label || mapping.path} verified`);
    log.success('Marketplace URLs verified against this tunnel');
    return 'synced';
  } catch (err) {
    if (signal?.aborted || isCancel(err)) throw err;
    const failure = marketplaceFailure('sync', err);
    await updateProjectState(dir, { marketplaceFailure: failure });
    printMarketplaceFailure(state, failure);
    return 'failed';
  }
}

function printDevSummary(a: {
  port: number;
  url: string;
  runtime: NonNullable<ReturnType<typeof getTemplate>>['runtime'];
  sync: SyncOutcome;
  healthOk?: boolean;
  urlMode?: UrlMode;
  verbose?: boolean;
}): void {
  const { port, url, runtime, sync, healthOk, urlMode } = a;
  log.plain('');
  log.plain(`  Local:   http://localhost:${port}`);
  log.plain(`  Public:  ${url}${urlMode === 'custom' ? ' (custom HTTPS)' : ' (ngrok)'}`);
  const webhook = runtime?.urlMappings?.find((m) => /webhook/i.test(m.label ?? m.path) || m.route === '/webhooks');
  if (webhook) {
    log.plain(`  Webhook: ${url.replace(/\/+$/, '')}${webhook.route ?? ''}`);
  }
  log.plain('');
  log.plain('  Zoom Marketplace:');
  if (sync === 'synced' || sync === 'already-synced') {
    log.plain('    ' + chalk.green(`Configuration verified — dev URLs point at this ${urlMode === 'custom' ? 'URL' : 'tunnel'}.`));
  } else if (sync === 'n/a') {
    log.plain('    ' + chalk.dim('Manual setup (this template configures its app outside the CLI).'));
  } else {
    log.plain('    ' + chalk.yellow(`NOT synchronized — Marketplace settings have not been verified against this ${urlMode === 'custom' ? 'URL' : 'tunnel'}.`));
    log.plain('    ' + chalk.dim('Run `zoom app sync` once credentials/app are ready.'));
  }
  log.plain('');
  const ready = (sync === 'synced' || sync === 'already-synced') && healthOk !== false;
  if (ready) {
    log.success('Local development is running.');
    log.plain('  Application functionality still needs a real Zoom interaction.');
    const instructions = runtime?.testInstructions ?? 'Install the development app and send the bot a Zoom Chat message to test delivery.';
    log.plain();
    const lines = instructions.split('\n');
    for (const line of a.verbose ? lines : lines.slice(0, 1)) log.plain('  ' + line);
    if (!a.verbose && lines.length > 1) log.dim('  See the project README for the complete interaction test.');
  } else if (sync === 'n/a') {
    log.success(`${urlMode === 'custom' ? 'Custom URL configured' : 'Tunnel active'}.`);
  } else {
    log.warn(`${urlMode === 'custom' ? 'URL configured' : 'Tunnel active'}, but the Zoom app is not fully configured yet (see above).`);
  }
}

async function devDocker(a: {
  dir: string;
  state: Awaited<ReturnType<typeof loadProjectState>>['state'];
  port: number;
  runtime: NonNullable<ReturnType<typeof getTemplate>>['runtime'];
  hasNgrokToken: () => boolean;
  startTunnel?: DevDeps['startTunnel'];
  waitForShutdown: () => Promise<void>;
}): Promise<number> {
  const { dir, port, runtime, hasNgrokToken, startTunnel, waitForShutdown } = a;
  if (!hasNgrokToken()) {
    log.error('ngrok is not configured — cannot establish an HTTPS tunnel.');
    log.dim('  Set NGROK_AUTHTOKEN (https://dashboard.ngrok.com) then re-run.');
    return 1;
  }
  if (!startTunnel) throw new Error('startTunnel dependency is required');
  const tunnel = await startTunnel({ port });
  try {
    log.success('ngrok tunnel established');
    log.success(`HTTPS URL resolved: ${tunnel.url}`);
    await updateProjectState(dir, { lastDevUrl: tunnel.url });
    log.plain('');
    log.warn('This is a docker-compose template — the CLI manages the tunnel, you run the containers.');
    log.plain(`  1. Set ${runtime?.publicUrlEnv ?? 'PUBLIC_URL'}=${tunnel.url} in .env`);
    log.plain(`  2. In another terminal:  ${runtime?.devCommand.join(' ')}`);
    log.plain(`  Public: ${tunnel.url}`);
    log.plain('');
    log.dim('Press Ctrl+C to stop the tunnel.');
    await waitForShutdown();
    return 0;
  } finally {
    await tunnel.close().catch(() => {});
  }
}
