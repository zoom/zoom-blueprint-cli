// `zoom configure` — reconcile an already-created project against its Marketplace app + active dev
// URL. Thin wrapper around `reconcileConfig` (src/config/reconcile.ts); `zoom dev` calls the same
// `reconcileProject` helper so there is ONE configuration routine, not two.

import { input, password, confirm as inquirerConfirm } from '@inquirer/prompts';
import { getEnv, getZoomCredentials, marketplaceAppUrl, type ZoomCredentialsResult } from '../config/env.js';
import { loadProjectState, type ProjectState } from '../config/project-state.js';
import { getTemplate, type Template } from '../templates/registry.js';
import { openMarketplaceSession, type OpenSession } from '../marketplace/session.js';
import { reconcileConfig, type ReconcileDeps, type ReconcileResult } from '../config/reconcile.js';
import { formatError, isCancel } from '../util/errors.js';
import { log, chalk, renderMarketplaceHelp } from '../util/logger.js';

export interface ConfigureDeps {
  cwd?: string;
  signal?: AbortSignal;
  env?: string;
  openSession?: OpenSession;
  getCreds?: () => ZoomCredentialsResult;
  /** Override the reconcile engine (tests). */
  reconcile?: typeof reconcileConfig;
  /** Override prompt/confirm (tests). */
  prompt?: ReconcileDeps['prompt'];
  confirm?: ReconcileDeps['confirm'];
}

export interface ConfigureOpts {
  /** Public base URL to reconcile against (falls back to state.lastDevUrl). */
  url?: string;
  /** Non-interactive: don't prompt for developer-supplied values. */
  yes?: boolean;
  verbose?: boolean;
}

/**
 * Shared reconcile routine used by BOTH `zoom configure` and `zoom dev`. Builds real deps (Marketplace
 * app-name lookup, interactive prompts) and runs `reconcileConfig`. Returns the result; the caller
 * decides how to report/act. Does NOT print a heading (callers own their own section headers).
 */
export async function reconcileProject(args: {
  dir: string;
  state: ProjectState;
  template: Template | undefined;
  baseUrl?: string;
  env: ReturnType<typeof getEnv>;
  creds: ZoomCredentialsResult;
  openSession: OpenSession;
  interactive: boolean;
  deps?: ConfigureDeps;
}): Promise<ReconcileResult> {
  const { dir, state, template, baseUrl, env, creds, openSession, interactive } = args;
  const run = args.deps?.reconcile ?? reconcileConfig;

  // Best-effort app-name lookup — only when we actually have a CLI login and a linked app.
  const getAppName =
    creds.ok && state.appId
      ? async (appId: string): Promise<string | undefined> => {
          const session = await openSession({ env, creds: creds.creds });
          const meta = await session.getApp(appId);
          return meta.appName;
        }
      : undefined;

  const deps: ReconcileDeps = {
    signal: args.deps?.signal,
    getAppName,
    onSaved: (label) => log.success(`${label} saved`),
    prompt:
      args.deps?.prompt ??
      (async ({ message, help, secret }) => {
        if (help) {
          log.plain();
          log.plain(renderMarketplaceHelp(help));
          log.plain();
        }
        return secret ? password({ message, mask: true }, { signal: args.deps?.signal }) : input({ message }, { signal: args.deps?.signal });
      }),
    confirm: args.deps?.confirm ?? ((message: string) => inquirerConfirm({ message, default: false }, { signal: args.deps?.signal })),
  };

  return run(
    {
      dir,
      spec: template?.reconcile,
      requiredEnv: template?.requiredEnv,
      baseUrl,
      interactive,
      appId: state.appId,
      marketplaceAppUrl: state.appId
        ? marketplaceAppUrl(getEnv(state.env || env.name), state.appId)
        : undefined,
      marketplaceSettingsUrl: state.appId
        ? (page) => marketplaceAppUrl(getEnv(state.env || env.name), state.appId!, page)
        : undefined,
    },
    deps,
  );
}

/** Print a reconcile result as a readable report. */
export function printReconcileReport(result: ReconcileResult, verbose = false): void {
  if (result.changes.length) {
    log.success('Environment updated');
    if (verbose) log.dim('  Local .env changes');
    for (const c of verbose ? result.changes : []) {
      const name = c.label ? `${c.key} (${c.label})` : c.key;
      log.plain(`    ${chalk.cyan(name)} = ${c.display}`);
    }
  } else if (verbose) {
    log.dim('  Local .env already matches the configuration.');
  }
  if (result.unresolved.length) {
    log.plain('');
    log.warn(`${result.unresolved.length} value(s) still need manual setup:`);
    for (const u of result.unresolved) {
      const name = u.label ? `${u.key} (${u.label})` : u.key;
      log.plain(`    ${chalk.yellow('-')} ${chalk.bold(name)}`);
      for (const line of renderMarketplaceHelp(u.how).split('\n')) {
        log.plain(line ? `      ${chalk.dim(line)}` : '');
      }
      log.plain();
    }
  }
}

export async function configure(opts: ConfigureOpts = {}, d: ConfigureDeps = {}): Promise<number> {
  const cwd = d.cwd ?? process.cwd();
  const getCreds = d.getCreds ?? (() => getZoomCredentials());
  const openSession = d.openSession ?? openMarketplaceSession;

  const { dir, state } = await loadProjectState(cwd);
  const env = getEnv(d.env ?? state.env);
  const template = getTemplate(state.templateId, state.blueprint);
  log.heading(`Configure — ${state.projectName}`);

  if (!template?.reconcile) {
    log.warn('This template has no post-creation configuration step.');
    log.dim('  Its .env is either fully generated at creation time or configured manually (see README).');
    return 0;
  }

  const baseUrl = opts.url || state.lastDevUrl;
  if (!baseUrl) {
    log.warn('No development URL known yet — URL-derived values (redirect URI, webview) will be deferred.');
    log.dim('  Run `zoom dev` (starts ngrok) or pass --url <https-url> to resolve them.');
  } else {
    log.dim(`  Reconciling against development URL: ${baseUrl}`);
  }

  try {
    const result = await reconcileProject({
      dir,
      state,
      template,
      baseUrl,
      env,
      creds: getCreds(),
      openSession,
      interactive: !opts.yes,
      deps: d,
    });
    log.plain('');
    printReconcileReport(result, opts.verbose);
    log.plain('');
    if (result.unresolved.length) {
      log.warn('Configuration incomplete — fill the values above, then re-run `zoom configure` or `zoom dev`.');
      return 1;
    }
    log.success('Project configuration reconciled.');
    return 0;
  } catch (err) {
    if (isCancel(err)) throw err;
    log.error('Configure did not complete:');
    log.plain(formatError(err, 'configure'));
    return 1;
  }
}
