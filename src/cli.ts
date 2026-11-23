import { warnUnverifiedNode } from './util/node-version.js';
// Scaffold the project before provisioning its Marketplace app so an API failure
// leaves the local files available for recovery. Templates own their manifests and
// environment examples. Management credentials stay separate from runtime credentials.

import fs from 'node:fs/promises';
import { marketplaceFailure, printMarketplaceFailure } from './util/marketplace-status.js';
import path from 'node:path';
import { projectSlashCommand, printMarketplaceSetup } from './util/marketplace-setup.js';
import { confirm } from '@inquirer/prompts';
import { readDotenvFile } from './config/dotenv.js';
import { isPlaceholderValue } from './config/reconcile.js';
import { getEnv, getZoomCredentials } from './config/env.js';
import { writeProjectState } from './config/project-state.js';
import {
  promptProjectName,
  promptAppType,
  promptTemplate,
  promptAppInfo,
  promptProviderApiKey,
  promptConfirmCreate,
} from './prompts.js';
import { compatibleTemplates, getTemplate, templateDefinition, type Template } from './templates/registry.js';
import { scaffoldTemplate } from './templates/scaffold.js';
import { PROVIDERS } from './providers.js';
import {
  generateGeneralAppManifest,
  validateManifestInputs,
  saveManifest,
  type ZoomManifest,
} from './manifest/index.js';
import { loadCanonicalManifest, buildResolvedManifest, BOOTSTRAP_DEV_URL } from './manifest/project.js';
import { createZoomApp } from './marketplace/provision.js';
import {
  buildEnvPlan,
  writeProjectEnv,
  unfilledKeys,
  overlayEnvFromExample,
  hasEnvExample,
} from './env-plan.js';
import { validateProjectName } from './util/validate.js';
import { CliError, isCancel } from './util/errors.js';
import { log, chalk } from './util/logger.js';
import { detectClaudeCode, writeDevDocs, initGitAndBranch, launchClaudeCode } from './dev-assistant.js';
import type { AgentConfig, AppInfo, CliFlags } from './types.js';

export async function run(flags: CliFlags): Promise<number> {
  warnUnverifiedNode();
  const env = getEnv(flags.env);
  const nonInteractive = !!flags.yes;

  // ---- 1. Collect configuration ------------------------------------------------
  const projectName = nonInteractive ? requireFlagName(flags.name) : await promptProjectName(flags.name);
  log.header(projectName);
  const appType = nonInteractive ? flags.appType || 'general' : await promptAppType(flags.appType);
  if (appType !== 'general') throw new CliError('Only General Apps are supported. Use --app-type general.');
  const template = await resolveTemplate(appType, flags.template, nonInteractive);
  if (flags.provider && (template.aiMode !== 'fixed' || !template.supportedProviders.includes(flags.provider))) {
    throw new CliError('Template "' + template.id + '" does not support --provider ' + flags.provider + '. ' +
      (template.aiMode === 'feature-specific'
        ? 'It uses Anthropic for Zoom Chat research and OpenAI for meeting intelligence and Zoom documents. Omit --provider.'
        : template.aiMode === 'none' ? 'This template has no built-in AI integration. Omit --provider.'
        : 'Its integration uses ' + template.supportedProviders.join(', ') + '.'));
  }
  const provider = template.aiMode === 'fixed' ? template.supportedProviders[0] : undefined;
  if (template.aiFeatures.length) log.heading('AI integrations');
  else log.plain('  This template has no built-in AI integration.');
  for (const feature of template.aiFeatures) log.plain('  ' + feature.name + ' — ' + PROVIDERS[feature.provider].label);
  const providerKeys: Record<string, string> = {};
  if (!nonInteractive) {
    for (const id of template.supportedProviders) {
      const key = await promptProviderApiKey(id);
      if (key) providerKeys[PROVIDERS[id].keyEnv] = key;
    }
  }
  const info: AppInfo = nonInteractive
    ? defaultAppInfo(projectName)
    : await promptAppInfo(defaultAppInfo(projectName));
  const providerApiKey = provider ? providerKeys[PROVIDERS[provider].keyEnv] || '' : '';

  // ---- 2. Resolve credentials & creation intent --------------------------------
  const zoom = getZoomCredentials();
  const wantCreate = flags.create !== false; // --no-create disables
  // Some samples have their own Marketplace build flow (Zoom Apps / RTMS config a generic manifest
  // can't express) — the CLI won't POST a generic app for those.
  const manualMarketplace = appType === 'general' && template.marketplaceSetup === 'manual';
  const canCreate = appType === 'general' && zoom.ok && wantCreate && !manualMarketplace;
  const config: AgentConfig = { projectName, appType, provider, templateId: template.id, info, createApp: canCreate, providerApiKey };

  // ---- 3. Validate app details (cheap, pre-scaffold) ---------------------------
  if (appType === 'general') {
    const issues = validateManifestInputs({ displayName: info.appName, description: info.description });
    if (issues.length) throw new CliError(`Invalid app details:\n  - ${issues.join('\n  - ')}`);
  }

  // ---- 4. Resolve destination (fail early, before any confirm/API/copy) --------
  // Default to a dedicated `./apps/` workspace so generated projects don't clutter the cwd and never
  // land inside the installed CLI package. An explicit --out-dir / --output overrides it.
  const outRoot = flags.outDir ? path.resolve(flags.outDir) : defaultWorkspaceRoot();
  const destDir = path.join(outRoot, projectName);
  assertSafeDest(destDir);
  await ensureEmptyDest(destDir);

  // ---- 5. Summary + explicit confirmation --------------------------------------
  printSummary(template, env, { canCreate, zoomMissing: zoom.missing, wantCreate, manualMarketplace, verbose: flags.verbose });
  if (!nonInteractive) {
    const proceed = await promptConfirmCreate(
      canCreate
        ? 'Create the Zoom Marketplace app and scaffold the project now?'
        : 'Scaffold the project now? (no Marketplace app will be created)',
    );
    if (!proceed) {
      log.warn('Cancelled — nothing was created.');
      return 0;
    }
  }

  // ---- 6. Scaffold the project FIRST (so failures never lose local work) --------
  const vars = {
    APP_NAME: info.appName,
    PROJECT_NAME: projectName,
    CHAT_COMMAND: projectSlashCommand(projectName),
    APP_DESCRIPTION: info.description,
    CONTACT_NAME: info.contactName,
    CONTACT_EMAIL: info.contactEmail,
    COMPANY_NAME: info.companyName,
  };
  log.step(`Scaffolding "${template.name}" into ${path.relative(process.cwd(), destDir) || '.'} …`);
  await scaffoldTemplate(template, destDir, vars);
  if (template.source.type === 'registered') {
    const ignore = path.join(destDir, '.gitignore');
    await fs.appendFile(ignore, '\n# Local runtime configuration\n.env\n.env.*\n!.env.example\n!.env.*.example\nnode_modules/\n');
  }
  log.success(`Project created: ${projectName}`);

  // ---- 7. Acquire the manifest (General App only) ------------------------------
  // Prefer a sample's capability-complete bundled manifest; otherwise generate a generic one.
  let manifest: ZoomManifest | undefined;
  let usedBundledManifest = false;
  if (appType === 'general' && !manualMarketplace) {
    if (template.manifestPath) {
      // Source of truth = the template's canonical manifest. Resolve {{APP_NAME}} and (at creation,
      // before any tunnel exists) {{DEV_BASE_URL}} → a valid bootstrap URL. We never submit literal
      // placeholders to Zoom; the real dev URLs are applied later by `zoom dev`.
      try {
        const canonical = await loadCanonicalManifest(destDir, template.manifestPath);
        manifest = buildResolvedManifest(canonical, {
          appName: info.appName,
          baseUrl: BOOTSTRAP_DEV_URL,
          urlMappings: template.runtime?.urlMappings,
        });
        usedBundledManifest = true;
      } catch (err) {
        log.warn(`Could not load the template manifest (${(err as Error).message}); using a generated one.`);
      }
    }
    if (!manifest) {
      manifest = generateGeneralAppManifest({
        displayName: info.appName,
        description: info.description,
        scopeDescription: template.requiredScopes.length
          ? `Requests Zoom scopes: ${template.requiredScopes.join(', ')}. ${info.description}`
          : info.description,
        products: template.products,
      });
      await saveManifest(manifest, path.join(destDir, 'zoom-manifest.json'));
    }
  }

  // ---- 8. Marketplace creation (General App only) ------------------------------
  let created: { appId?: string; clientId?: string; clientSecret?: string } | undefined;
  let createError: unknown;
  if (canCreate && manifest) {
    log.step('Creating Zoom Marketplace app via the Create App API …');
    try {
      const result = await createZoomApp({
        env,
        zoomCreds: zoom.creds,
        manifest,
        options: { products: template.products, recoveryId: projectName, appInfo: info, createAppRetries: 1 },
      });
      created = { appId: result.appId, clientId: result.clientId, clientSecret: result.clientSecret };
      log.success(`Zoom Marketplace app created (app_id: ${result.appId})`);
      if (usedBundledManifest) log.dim('  Used the template\'s capability-complete manifest.');
      if (template.runtime?.urlMappings?.length) {
        log.warn('  App status: AWAITING DEVELOPMENT URL CONFIGURATION.');
        log.dim('  Its OAuth/webhook URLs are placeholders. Run `zoom dev` to resolve the live HTTPS');
        log.dim('  URL via ngrok and synchronize the Marketplace configuration before testing.');
      }
      if (result.clientSecret) {
        log.dim('  The app client secret was returned once and saved to .env only — it is not printed here.');
      }
    } catch (err) {
      createError = err;

    }
  }

  // ---- 10. Environment configuration ------------------------------------------
  let envUnfilled: string[] = [];
  if (await hasEnvExample(destDir)) {
    // Reused sample: fill known keys into a copy of the sample's own .env.example.
    const values = { ...buildOverlayValues(created), ...providerKeys };
    const res = await overlayEnvFromExample(destDir, values);
    const projectEnv = readDotenvFile(res.envPath);
    const setupKeys = new Set([
      ...template.requiredEnv,
      ...(template.reconcile?.promptVars ?? []).map(({ name }) => name),
    ]);
    envUnfilled = [...setupKeys].filter((key) => isPlaceholderValue(projectEnv?.[key]));
    log.success('Environment updated');

  } else {
    const entries = buildEnvPlan({
      appType,
      provider,
      providerKeys,
      template,
      providerApiKey,
      created,
    });
    await writeProjectEnv(destDir, entries);
    envUnfilled = unfilledKeys(entries);
    log.success('Environment configuration written (.env, .env.example)');
  }

  // NOTE: CLI management tokens are intentionally NOT written into the project. `zoom dev` /
  // `zoom app sync` use the saved public OAuth session. Projects keep only their own runtime creds.

  // ---- 10b. Write project state (.zoom-agent.json) — links project ↔ template ↔ app ------------
  const stateManifestPath =
    template.manifestPath ?? (appType === 'general' && !manualMarketplace ? 'zoom-manifest.json' : undefined);
  await writeProjectState(destDir, {
    version: 1,
    projectName,
    templateId: template.id,
    ...(template.source.type === 'registered' ? { blueprint: templateDefinition(template) } : {}),
    appInfo: info,
    appType,
    provider,
    env: env.name,
    marketplaceSetup: manualMarketplace ? 'manual' : 'auto',
    manifestPath: stateManifestPath,
    appId: created?.appId,
    marketplaceFailure: createError ? marketplaceFailure('create', createError) : undefined,
    createdAt: new Date().toISOString(),
  });

  // ---- 11. Optional Claude Code customization ----------------------------------
  await maybeRunClaudeCode(config, template, destDir, flags, nonInteractive);

  // ---- 12. Final developer experience -----------------------------------------
  printNextSteps(config, template, env, {
    destDir,
    created,
    createError,
    canCreate,
    wantCreate,
    zoomMissing: zoom.missing,
    unfilled: envUnfilled,
    manualMarketplace,
  });

  if (createError) {

    return 1;
  }
  return 0;
}

// ---- helpers ----------------------------------------------------------------

function requireFlagName(name?: string): string {
  if (!name) throw new CliError('--name is required in non-interactive (--yes) mode.');
  const r = validateProjectName(name);
  if (!r.ok) throw new CliError(`Invalid --name: ${r.message}`);
  return name;
}

async function resolveTemplate(
  appType: 'general',
  preset: string | undefined,
  nonInteractive: boolean,
): Promise<Template> {
  if (nonInteractive) {
    if (preset) {
      const t = getTemplate(preset);
      if (!t) throw new CliError(`Unknown template "${preset}".`);
      if (!t.compatibleAppTypes.includes(appType)) {
        throw new CliError(`Template "${preset}" is not compatible with ${appType}.`);
      }
      return t;
    }
    const choices = compatibleTemplates(appType);
    if (!choices.length) throw new CliError(`No template supports ${appType}.`);
    return choices[0];
  }
  return promptTemplate(appType, undefined, preset);
}

function defaultAppInfo(projectName: string): AppInfo {
  const pretty = projectName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    appName: pretty,
    description: `${pretty} — an AI agent for Zoom Workplace.`,
    contactName: 'Zoom Developer',
    contactEmail: 'developer@example.com',
    companyName: 'Zoom Developer',
  };
}

/**
 * Default project workspace: `./apps` relative to the current working directory. This is predictable
 * for both repository development (creates `<repo>/apps/<name>`) and standalone/npx usage (creates
 * `<cwd>/apps/<name>`), and — being cwd-relative — never writes into the installed npm package dir.
 */
export function defaultWorkspaceRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, 'apps');
}

/** Refuse destinations that would write into a package/dependency tree. */
export function assertSafeDest(destDir: string): void {
  if (destDir.split(path.sep).includes('node_modules')) {
    throw new CliError(`Refusing to scaffold into a node_modules path: ${destDir}`);
  }
}

async function ensureEmptyDest(destDir: string): Promise<void> {
  try {
    const entries = (await fs.readdir(destDir)).filter((e) => e !== '.DS_Store');
    if (entries.length > 0) {
      throw new CliError(`Destination "${destDir}" already exists and is not empty. Choose another name or remove it.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

function buildOverlayValues(
  created: { appId?: string; clientId?: string; clientSecret?: string } | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (created?.appId) values.ZOOM_APP_ID = created.appId;
  if (created?.clientId) values.ZOOM_CLIENT_ID = created.clientId;
  if (created?.clientSecret) values.ZOOM_CLIENT_SECRET = created.clientSecret;
  return values;
}

async function maybeRunClaudeCode(
  config: AgentConfig,
  template: Template,
  destDir: string,
  flags: CliFlags,
  nonInteractive: boolean,
): Promise<void> {
  if (!template.claudeCodeSupported) return;

  let opt = flags.claudeCode;
  if (!nonInteractive && opt === undefined) {
    opt = await confirm({
      message: 'Would you like to customize this project using Claude Code?',
      default: false,
    });
  }
  if (!opt) return;

  const rel = path.relative(process.cwd(), destDir) || '.';
  const docs = await writeDevDocs(destDir, config, template);
  log.success(`Generated ${docs.map((d) => path.basename(d)).join(' + ')} (architecture + dev brief)`);

  const branch = flags.branch || 'customize';
  const git = await initGitAndBranch(destDir, branch);
  if (!git.gitAvailable) log.dim('  git not found — skipped repo init / branch.');
  else if (git.initialized) log.success(`Initialized git repo${git.branch ? ` on branch "${git.branch}"` : ''}`);
  else if (git.branch) log.success(`Created git branch "${git.branch}"`);

  const det = await detectClaudeCode();
  if (!det.available) {
    log.warn('Claude Code is not installed.');
    log.dim(`  ${det.installHint}`);
    log.dim('  CLAUDE.md is ready, so any coding assistant can pick up the architecture.');
    return;
  }
  if (nonInteractive) {
    log.dim(`Claude Code ${det.version} detected. Launch it with:  cd ${rel} && claude`);
    return;
  }
  const launch = await confirm({ message: `Launch Claude Code now in ${config.projectName}?`, default: true });
  if (launch) {
    log.step('Launching Claude Code (your normal auth) …');
    await launchClaudeCode(destDir);
  } else {
    log.dim(`  Later:  cd ${rel} && claude`);
  }
}

function printSummary(
  template: Template,
  env: ReturnType<typeof getEnv>,
  ctx: { canCreate: boolean; zoomMissing: string[]; wantCreate: boolean; manualMarketplace: boolean; verbose?: boolean },
): void {
  log.plain(`  Template:         ${template.name}`);
  if (ctx.verbose) {
    log.plain(`  Required scopes:  ${template.requiredScopes.join(', ') || '(none)'}`);
    log.plain(`  Capabilities:     ${template.requiredCapabilities.join(', ') || '(none)'}`);
    log.plain(`  Marketplace API:  ${env.zoomApiBase}`);
  }
  log.plain('');
  if (ctx.manualMarketplace) {
    log.plain('  Marketplace op:   ' + chalk.yellow('Manual setup (this sample has its own Marketplace build flow)'));
  } else if (ctx.canCreate) {
    log.plain('  Marketplace:      create and link a General App');
    if (ctx.verbose && template.manifestPath) log.plain('  Manifest:         ' + template.manifestPath);
  } else if (!ctx.wantCreate) {
    log.plain('  Marketplace op:   ' + chalk.dim('skipped (--no-create)'));
  } else {
    log.plain('  Marketplace op:   ' + chalk.yellow(`skipped — missing ${ctx.zoomMissing.join(', ')}`));
  }
}

function printNextSteps(
  config: AgentConfig,
  template: Template,
  env: ReturnType<typeof getEnv>,
  ctx: {
    destDir: string;
    created?: { appId?: string };
    createError?: unknown;
    canCreate: boolean;
    wantCreate: boolean;
    zoomMissing: string[];
    unfilled: string[];
    manualMarketplace: boolean;
  },
): void {


  if (config.appType === 'general' && ctx.manualMarketplace) {
    log.warn('Marketplace app NOT created — this sample has its own Marketplace build flow.');
    log.dim('  Follow the project README to configure the app (Home/redirect URLs, Zoom Apps / RTMS');
    log.dim('  scopes). RTMS additionally requires enabling Real-Time Media Streams on your account.');
  } else if (config.appType === 'general') {
    if (ctx.createError) {
      printMarketplaceFailure({ env: env.name, manifestPath: template.manifestPath || 'zoom-manifest.json' }, marketplaceFailure('create', ctx.createError));
    } else if (!ctx.canCreate) {
      log.warn('Zoom Marketplace app NOT created.');
      if (!ctx.wantCreate) {
        log.dim('  Creation was disabled (--no-create).');
      } else {
        log.dim(`  Missing credentials: ${ctx.zoomMissing.join(', ')}.`);
        log.dim('  Run zoom login to authorize the CLI.');
        log.dim('  Then run zoom app create from this project.');
      }
    }
  }

  log.heading('Next steps');
  const rel = path.relative(process.cwd(), ctx.destDir) || '.';
  const shellPath = /^[\w./-]+$/.test(rel) ? rel : "'" + rel.replace(/'/g, "'\\''") + "'";
  log.plain('  1. Install dependencies');
  log.plain(`     cd -- ${shellPath}`);
  for (const cmd of template.setupCommands) log.plain(`     ${cmd}`);

  log.plain('');
  log.plain('  2. Review .env');
  const guidedKeys = new Set([
    ...(template.reconcile?.promptVars ?? []).map(value => value.name),
    ...(template.reconcile?.generateVars ?? []).map(value => value.name),
    ...(template.reconcile?.urlVars ?? []).map(value => value.name),
  ]);
  const reviewKeys = ctx.unfilled.filter(key => !guidedKeys.has(key));
  if (reviewKeys.length) {
    log.plain('     Unset or placeholder values');
    for (const key of reviewKeys) log.plain(`       • ${key}`);
  }
  for (const note of template.setupNotes ?? []) log.plain('     • ' + note);
  log.plain('     See .env.example and the project README for setup details.');

  log.plain('');
  log.plain('  3. Start local development');
  const syncCapable =
    (template.runtime?.kind === 'server' || template.runtime?.kind === 'docker') &&
    !!template.manifestPath &&
    !ctx.manualMarketplace;
  if (syncCapable) {
    const devCommand = ctx.created?.appId ? 'zoom dev' : 'zoom dev --no-sync';
    log.plain();
    log.plain('     Use ngrok');
    log.plain('       Set NGROK_AUTHTOKEN in the CLI root .env once, then run');
    log.plain(`       ${devCommand}`);
    log.plain();
    log.plain('     Use an existing public HTTPS endpoint');
    log.plain(`       ${devCommand} --url https://your-dev-host.example`);
    log.plain();
    if (ctx.created?.appId) {
      log.plain('     The CLI will offer to sync your development URLs to Marketplace.');
    } else {
      log.dim('     To link an existing app, run zoom app link --app-id <id>.');
    }
  } else {
    for (const cmd of template.startCommands) log.plain(`     ${cmd}`);
  }
  if (template.runtime?.testInstructions) {
    log.plain();
    log.plain('  4. Test the app in Zoom');
    if (!ctx.created?.appId) log.plain('     Link a Marketplace app and run zoom dev to sync its URLs first.');
    for (const line of template.runtime.testInstructions.split('\n')) log.plain('     ' + line);
  }
  if (ctx.created?.appId) {
    log.plain();
    printMarketplaceSetup(env, ctx.created.appId);
  }
}

export { isCancel };
