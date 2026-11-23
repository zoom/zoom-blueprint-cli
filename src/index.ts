#!/usr/bin/env node
import { blueprintRegister, blueprintList, blueprintInspect, blueprintUnregister } from './commands/blueprint.js';
import { login, logout, authStatus, authCheck } from './commands/auth.js';
// create-zoom-agent / zoom — scaffold AND run AI agents for Zoom Workplace.
//
//   zoom create [name]          interactive wizard (default command)
//   zoom dev                    local dev: server + ngrok + manifest sync
//   zoom doctor                 diagnose project/config/connectivity
//   zoom app validate|diff|sync Marketplace manifest lifecycle

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { run } from './cli.js';
import { dev } from './commands/dev.js';
import { realDevDeps } from './commands/dev-runtime.js';
import { doctor } from './commands/doctor.js';
import { configure } from './commands/configure.js';
import { appLink, appValidate, appDiff, appSync } from './commands/app.js';
import { appCreate } from './commands/app-create.js';
import { appDelete } from './commands/app-delete.js';
import { projectDelete } from './commands/project-delete.js';
import { loadDotenv } from './config/dotenv.js';
import { managementCredCandidates, loadRootTunnelConfig } from './config/management-creds.js';
import { findProjectRoot } from './config/project-state.js';

/** Package root (…/dist or …/src → up one). The CLI's own .env lives here when dev-linked. */
const CLI_PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Load CLI-only tunnel configuration independently of app runtime values. */
function loadManagementCreds(_verbose = false): void {
  const candidates = managementCredCandidates(CLI_PACKAGE_ROOT);
  loadRootTunnelConfig(candidates);

}
import { formatError, isCancel } from './util/errors.js';
import { log } from './util/logger.js';
import { listTemplates, type AppType } from './templates/registry.js';
import type { CliFlags } from './types.js';
import type { ProviderId } from './providers.js';

/** Load ./.env (or --env-file) so Zoom credentials are available; real env vars take precedence. */
function loadLocalEnv(envFile?: string, verbose = false): void {
  const file = path.resolve(process.cwd(), envFile || '.env');
  const loaded = loadDotenv(file);
  if (verbose && loaded.loaded && loaded.keys.length) {
    log.dim(`Loaded ${loaded.keys.length} variable(s) from ${path.relative(process.cwd(), file) || '.env'}`);
  }
}

/**
 * Load env for project commands (dev/doctor/app). Precedence: shell env (already set, never
 * overridden) > `--env-file` > the PROJECT ROOT's `.env` (discovered by walking up from cwd, so it
 * works from nested directories). We deliberately do NOT scan arbitrary parent `.env` files for
 * secrets — only the discovered project root.
 */
async function loadProjectEnv(envFile?: string, verbose = false): Promise<void> {
  // 1. --env-file wins (after shell env).
  if (envFile) {
    const f = path.resolve(process.cwd(), envFile);
    const r = loadDotenv(f);
    if (verbose && r.loaded && r.keys.length) log.dim(`Loaded ${r.keys.length} variable(s) from ${path.relative(process.cwd(), f) || f}`);
  }
  // 2. Central CLI tunnel configuration.
  loadManagementCreds(verbose);
  // 3. The project's own .env (the app's runtime values; inherited by the spawned dev server).
  const root = await findProjectRoot(process.cwd());
  if (root) {
    const f = path.join(root, '.env');
    const r = loadDotenv(f, { exclude: ['NGROK_AUTHTOKEN'] });
    if (verbose && r.loaded && r.keys.length) log.dim(`Loaded ${r.keys.length} variable(s) from ${path.relative(process.cwd(), f) || '.env'}`);
  }
}

/** Flush deferred diagnostics before exiting, including cancellation and server failures. */
async function finishAction(code: number): Promise<never> {
  await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(resolve => {
    if (stream.destroyed) return resolve();
    stream.write('', () => resolve());
  })));
  process.exit(code);
}

/** Run an async action returning an exit code, with uniform error handling. */
async function runAction(fn: () => Promise<number>): Promise<never> {
  try {
    return await finishAction(await fn());
  } catch (err) {
    if (isCancel(err)) {
      log.plain();
      log.warn('Cancelled.');
      return await finishAction(130);
    }
    log.error('');
    log.plain(formatError(err));
    return await finishAction(1);
  }
}

const program = new Command();
program
  .name('zoom')
  .description('Create, configure, run, and test AI agents on Zoom Workplace.')
  .version('0.2.0');

// CLI authorization is independent of generated app credentials.
program.command('login').description('Sign in through Zoom public-client PKCE OAuth')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--env-file <path>', 'CLI configuration .env file')
  .option('--port <port>', 'loopback callback port; default is an available port')
  .option('--no-browser', 'print the authorization URL instead of opening a browser')
  .action(opts => runAction(async () => login(opts, { candidates: [path.resolve(process.cwd(), opts.envFile || '.env'), ...managementCredCandidates(CLI_PACKAGE_ROOT)] })));
program.command('logout').description('Revoke the saved public OAuth token and remove local login')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .action(opts => runAction(() => logout(opts)));
const auth = program.command('auth').description('Inspect CLI authorization');
auth.command('status').description('Show local public OAuth login status without displaying tokens')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .action(opts => runAction(() => authStatus(opts)));
auth.command('check').description('Verify public OAuth read and validation access without changing an app')
  .requiredOption('--app-id <id>', 'existing Marketplace app to read and validate')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .action(opts => runAction(() => authCheck(opts)));

const blueprint = program.command('blueprint').description('Register and manage reusable local application templates');
blueprint.command('register').argument('<folder>', 'local sample folder')
  .description('Validate and save a local blueprint snapshot without executing sample code')
  .option('-y, --yes', 'noninteractive; requires zoom-blueprint.json and skips confirmation')
  .action((folder, opts) => runAction(() => blueprintRegister(folder, opts)));
blueprint.command('list').description('List bundled and locally registered blueprints')
  .action(() => runAction(() => blueprintList()));
blueprint.command('inspect').argument('<id>', 'blueprint ID').description('Inspect a blueprint or export its portable definition')
  .option('--json', 'print only the versioned JSON definition')
  .action((id, opts) => runAction(() => blueprintInspect(id, opts)));
blueprint.command('unregister').argument('<id>', 'locally registered blueprint ID')
  .description('Remove a registration without changing generated projects or Marketplace apps')
  .option('-y, --yes', 'skip confirmation')
  .action((id, opts) => runAction(() => blueprintUnregister(id, opts)));

// ---- create (default) -------------------------------------------------------
program
  .command('create', { isDefault: true })
  .description('Scaffold a new Zoom agent project (interactive wizard)')
  .argument('[project-name]', 'agent project name (skips the first prompt)')
  .option('-n, --name <name>', 'project name')
  .option('-t, --app-type <type>', 'Zoom app type: general')
  .option('-p, --provider <provider>', 'fixed-provider compatibility check (chat-ai-assistant: anthropic)')
  .option('--template <id>', 'bundled or registered blueprint ID; see zoom blueprint list')
  .option('-o, --out-dir <dir>', 'parent directory to create the project in (default: ./apps)')
  .option('--output <dir>', 'alias for --out-dir')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--env-file <path>', 'CLI configuration .env file (default: ./.env)')
  .option('--no-create', 'do not create the Marketplace app (scaffold only)')
  .option('--verbose', 'show detailed template and Marketplace setup information')
  .option('--claude-code', 'generate CLAUDE.md + dev brief and a git branch for Claude Code customization')
  .option('--branch <name>', 'development branch name for the Claude Code step', 'customize')
  .option('-y, --yes', 'non-interactive: use flags/defaults, skip prompts and confirmation')
  .addHelpText(
    'after',
    () => `
Templates:
${listTemplates().map((t) => `  ${t.id.padEnd(22)} ${t.compatibleAppTypes.join('/')}  — ${t.name}; setup: ${t.setupCommands.join(' && ')}`).join('\n')}`,
  )
  .action((projectNameArg: string | undefined, opts: Record<string, unknown>) =>
    runAction(async () => {
      const flags: CliFlags = {
        name: (opts.name as string) || projectNameArg,
        appType: opts.appType as AppType | undefined,
        provider: opts.provider as ProviderId | undefined,
        template: opts.template as string | undefined,
        outDir: (opts.output as string | undefined) || (opts.outDir as string | undefined),
        env: opts.env as string | undefined,
        yes: opts.yes as boolean | undefined,
        verbose: !!opts.verbose,
        create: opts.create as boolean | undefined, // commander: --no-create → false
        claudeCode: opts.claudeCode as boolean | undefined,
        branch: opts.branch as string | undefined,
      };
      loadLocalEnv(opts.envFile as string | undefined, !!opts.verbose);
      loadManagementCreds(!!opts.verbose); // Load CLI tunnel configuration.
      validateEnumFlags(flags);
      return run(flags);
    }),
  );

// ---- dev --------------------------------------------------------------------
program
  .command('dev')
  .description('Start local development: dev server + ngrok tunnel + manifest sync')
  .option('-e, --env <env>', 'Zoom environment: prod (default: project environment)')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .option('--url <url>', 'use a custom HTTPS URL instead of ngrok (ngrok uses NGROK_AUTHTOKEN)')
  .option('--no-sync', 'do not synchronize the Marketplace app configuration')
  .option('-y, --yes', 'auto-confirm the configuration sync')
  .option('--port <n>', 'override the dev server port')
  .option('--verbose', 'stream detailed runtime output after setup; logs are always saved to disk')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return dev(
        {
          yes: opts.yes as boolean,
          noSync: opts.sync === false,
          verbose: !!opts.verbose,
          port: opts.port ? Number(opts.port) : undefined,
          url: opts.url as string | undefined,
        },
        { ...realDevDeps, env: opts.env as string | undefined },
      );
    }),
  );

// ---- doctor -----------------------------------------------------------------
program
  .command('doctor')
  .description('Diagnose project configuration, manifest, and connectivity')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return doctor({ env: opts.env as string | undefined });
    }),
  );

// ---- configure --------------------------------------------------------------
program
  .command('configure')
  .description('Reconcile the project .env against its Marketplace app + active development URL')
  .option('-e, --env <env>', 'Zoom environment: prod (default: project environment)')
  .option('--url <url>', 'public base URL to resolve dev URL fields against (default: last dev URL)')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .option('-y, --yes', 'non-interactive: do not prompt for developer-supplied values')
  .option('--verbose', 'show local environment changes with secrets masked')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return configure(
        { url: opts.url as string | undefined, yes: opts.yes as boolean | undefined, verbose: !!opts.verbose },
        { env: opts.env as string | undefined },
      );
    }),
  );

// Marketplace app commands
const app = program.command('app').description('Zoom Marketplace manifest lifecycle');
app
  .command('create')
  .description('Create and link a Marketplace app for an existing scaffold')
  .option('--url <url>', 'public HTTPS base URL (default: last dev URL or bootstrap URL)')
  .option('--env-file <path>', 'path to a .env file with management credentials')
  .option('-y, --yes', 'skip the creation confirmation')
  .action((opts: { url?: string; envFile?: string; yes?: boolean }) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile);
      return appCreate({ url: opts.url, yes: opts.yes });
    }),
  );
app
  .command('link')
  .description('Verify access to an existing Marketplace app and link it to this project')
  .requiredOption('--app-id <id>', 'existing Marketplace app ID')
  .option('-e, --env <env>', 'Zoom environment: prod (default: project environment)')
  .option('--env-file <path>', 'path to a .env file with management credentials')
  .action((opts: { appId: string; env?: string; envFile?: string }) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile);
      return appLink(opts.appId, { env: opts.env });
    }),
  );
app
  .command('validate')
  .description('Validate the manifest locally and (if authorized) against Zoom')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--url <url>', 'public base URL to resolve dev URL fields against')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return appValidate({ url: opts.url as string | undefined }, { env: opts.env as string | undefined });
    }),
  );
app
  .command('diff')
  .description('Diff the proposed manifest against the remote Marketplace app')
  .option('-e, --env <env>', 'Zoom environment: prod (default: project environment)')
  .option('--url <url>', 'public base URL to resolve dev URL fields against')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return appDiff({ url: opts.url as string | undefined }, { env: opts.env as string | undefined });
    }),
  );
app
  .command('sync')
  .description('Safely synchronize the remote Marketplace app (validate → diff → confirm → apply → verify)')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--url <url>', 'public base URL to resolve dev URL fields against')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return appSync(
        { url: opts.url as string | undefined, yes: opts.yes as boolean | undefined },
        { env: opts.env as string | undefined, chooseSync: realDevDeps.chooseSync },
      );
    }),
  );
app
  .command('delete')
  .description('Permanently delete the linked Marketplace app (local files preserved)')
  .option('-e, --env <env>', 'Zoom environment: prod', 'prod')
  .option('--env-file <path>', 'path to a .env file with credentials (default: project .env)')
  .action((opts: Record<string, unknown>) =>
    runAction(async () => {
      await loadProjectEnv(opts.envFile as string | undefined, !!opts.verbose);
      return appDelete({}, { env: opts.env as string | undefined });
    }),
  );

// ---- project delete ---------------------------------------------------------
program
  .command('project')
  .description('Project management commands')
  .addCommand(
    new Command('delete')
      .description('Permanently delete the local project directory (Marketplace app preserved)')
      .action(() =>
        runAction(async () => {
          return projectDelete({});
        }),
      ),
  );

function validateEnumFlags(flags: CliFlags): void {
  if (flags.appType && flags.appType !== 'general') {
    throw new Error(`--app-type must be "general", got "${flags.appType}".`);
  }
  if (flags.provider && !['anthropic', 'openai'].includes(flags.provider)) {
    throw new Error(`--provider must be "anthropic" or "openai", got "${flags.provider}".`);
  }
}

program.parseAsync(process.argv).catch((err) => {
  log.plain(formatError(err));
  process.exit(1);
});
