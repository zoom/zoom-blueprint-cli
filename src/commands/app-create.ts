import { warnUnverifiedNode } from '../util/node-version.js';
import { promptAppInfo } from '../prompts.js';
import fs from 'node:fs/promises';
import { marketplaceFailure, printMarketplaceFailure } from '../util/marketplace-status.js';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { getEnv, getZoomCredentials, type ZoomCredentialsResult } from '../config/env.js';
import { loadProjectState, updateProjectState } from '../config/project-state.js';
import { writeEnvVars } from '../config/envfile.js';
import { getTemplate } from '../templates/registry.js';
import { loadCanonicalManifest, buildResolvedManifest, BOOTSTRAP_DEV_URL } from '../manifest/project.js';
import { innerManifest } from '../manifest/resolve.js';
import { createZoomApp } from '../marketplace/provision.js';
import { CliError } from '../util/errors.js';
import { log } from '../util/logger.js';
import { projectSlashCommand, printMarketplaceSetup } from '../util/marketplace-setup.js';

export interface AppCreateDeps {
  cwd?: string;
  getCreds?: () => ZoomCredentialsResult;
  create?: typeof createZoomApp;
  confirm?: (message: string) => Promise<boolean>;
}

/** Resume provisioning without overwriting the scaffold, installed dependencies, or user edits. */
export async function appCreate(opts: { yes?: boolean; url?: string } = {}, deps: AppCreateDeps = {}): Promise<number> {
  warnUnverifiedNode();
  const { dir, state } = await loadProjectState(deps.cwd);
  const template = getTemplate(state.templateId, state.blueprint);
  if (state.appId) throw new CliError(`This project is already linked to ${state.appId}. Use zoom configure or zoom dev.`);
  if (state.appType !== 'general' || !state.manifestPath || !template || template.marketplaceSetup === 'manual') {
    throw new CliError('This project does not support Marketplace creation from its manifest.');
  }
  const credentials = (deps.getCreds ?? getZoomCredentials)();
  if (!credentials.ok) throw new CliError(`Run zoom login to authorize Marketplace access: ${credentials.missing.join(', ')}.`);
  const env = getEnv(state.env);
  const canonical = await loadCanonicalManifest(dir, state.manifestPath);
  const inner = innerManifest(canonical);
  const slashCommand = inner.features?.team_chat_subscription?.slash_command;
  // Repair only the original HITL sample default; preserve developer-chosen commands.
  let repairedCommand = false;
  if (state.templateId === 'hitl-workplace-agent' && slashCommand && ['zwc', '{{CHAT_COMMAND}}'].includes(slashCommand.command)) {
    slashCommand.command = projectSlashCommand(state.projectName);
    repairedCommand = true;
  }
  const manifest = buildResolvedManifest(canonical, {
    appName: inner.display_information?.display_name === '{{APP_NAME}}' ? state.projectName : inner.display_information?.display_name,
    baseUrl: opts.url || state.lastDevUrl || BOOTSTRAP_DEV_URL,
    urlMappings: template.runtime?.urlMappings,
  });
  let appInfo = state.appInfo;
  if (credentials.creds.publicOAuth && !appInfo) {
    if (opts.yes) throw new CliError('Developer contact information is missing. Run zoom app create without --yes to enter it.');
    appInfo = await promptAppInfo({ appName: state.projectName });
    await updateProjectState(dir, { appInfo });
  }
  log.heading(`Create Marketplace app — ${state.projectName}`);
  log.plain(`  Marketplace: ${env.marketplaceUrl}`);
  if (!opts.yes && !await (deps.confirm ?? ((message) => confirm({ message, default: false })))(
    'Create a Marketplace app from this project manifest and link it now?',
  )) return 0;
  try {
    if (repairedCommand) {
      await fs.writeFile(path.join(dir, state.manifestPath), JSON.stringify(canonical, null, 2) + '\n');
      log.plain(`  Zoom Chat slash command: /${slashCommand.command}`);
    }
    const result = await (deps.create ?? createZoomApp)({
      env, zoomCreds: credentials.creds, manifest,
      options: { products: template.products, recoveryId: state.projectName, createAppRetries: 1, appInfo },
    });
    // Save the app identity before any optional credential writes so a partial local failure cannot hide it.
    await updateProjectState(dir, { appId: result.appId, marketplaceFailure: undefined });
    const entries = [
      { key: 'ZOOM_APP_ID', value: result.appId },
      ...(result.clientId ? [{ key: 'ZOOM_CLIENT_ID', value: result.clientId }] : []),
      ...(result.clientSecret ? [{ key: 'ZOOM_CLIENT_SECRET', value: result.clientSecret }] : []),
    ];
    await writeEnvVars(path.join(dir, '.env'), entries);
    log.success(`Marketplace app created and linked: ${result.appId}`);
    printMarketplaceSetup(env, result.appId);

    return 0;
  } catch (err) {
    const failure = marketplaceFailure('create', err);
    const current = await loadProjectState(dir);
    await updateProjectState(dir, { marketplaceFailure: failure });
    printMarketplaceFailure(current.state, failure);
    log.warn('Creation did not finish. Your project is preserved. Check .zoom-agent.json before retrying.');
    return 1;
  }
}
