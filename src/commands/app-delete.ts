// `zoom app delete` — safe Marketplace app deletion with typed confirmation.

import { input } from '@inquirer/prompts';
import { getEnv, getZoomCredentials, type ZoomCredentialsResult } from '../config/env.js';
import { loadProjectState, updateProjectState } from '../config/project-state.js';
import { openMarketplaceSession, type OpenSession } from '../marketplace/session.js';
import { deleteAppById } from '../marketplace/client.js';
import { formatError } from '../util/errors.js';
import { log, chalk } from '../util/logger.js';

export interface AppDeleteDeps {
  cwd?: string;
  env?: string;
  getCreds?: () => ZoomCredentialsResult;
  openSession?: OpenSession;
  deleteApp?: typeof deleteAppById;
  /** Override confirmation prompt (tests only). */
  promptConfirmation?: (appName: string, appId: string) => Promise<string>;
}

export interface AppDeleteOpts {
  /** Skip the typed confirmation (DANGEROUS - only for tests). */
  yes?: boolean;
}

/**
 * Delete a Zoom Marketplace app with typed confirmation. Preserves local project files.
 * Updates project state to mark the app as deleted/unlinked.
 */
export async function appDelete(opts: AppDeleteOpts = {}, d: AppDeleteDeps = {}): Promise<number> {
  const cwd = d.cwd ?? process.cwd();
  const env = getEnv(d.env);
  const getCreds = d.getCreds ?? (() => getZoomCredentials());
  const openSession = d.openSession ?? openMarketplaceSession;
  const deleteApp = d.deleteApp ?? deleteAppById;

  const { dir, state } = await loadProjectState(cwd);

  log.heading('Delete Marketplace App');
  log.plain(`  Project: ${state.projectName}`);
  log.plain('');

  // Check if app is linked
  if (!state.appId) {
    log.warn('No Marketplace app is linked to this project.');
    log.dim('  The project has no appId in .zoom-agent.json — nothing to delete remotely.');
    return 0;
  }

  // Check credentials
  const creds = getCreds();
  if (!creds.ok) {
    log.error(`Zoom credentials required to delete the Marketplace app — missing ${creds.missing.join(', ')}.`);
    log.dim('  Run zoom login to authorize Marketplace access.');
    return 1;
  }

  try {
    // Fetch app metadata for display and confirmation
    const session = await openSession({ env, creds: creds.creds });
    const appMeta = await session.getApp(state.appId);
    const appName = appMeta.appName || state.appId;
    const appId = state.appId;

    // Display deletion target and consequences
    log.plain(chalk.red('⚠️  WARNING: This will permanently delete the Marketplace app.'));
    log.plain('');
    log.plain('  App details:');
    log.plain(`    Name:        ${appName}`);
    log.plain(`    App ID:      ${appId}`);
    log.plain(`    App Type:    ${appMeta.appType || 'unknown'}`);
    log.plain(`    Environment: ${env.name}`);
    log.plain('');
    log.plain('  Consequences:');
    log.plain('    • The Marketplace app will be permanently deleted');
    log.plain('    • Users will no longer be able to authorize or use this app');
    log.plain('    • OAuth tokens for this app will be invalidated');
    log.plain('    • This operation cannot be undone');
    log.plain('');
    log.plain(chalk.yellow('  Local project files will NOT be deleted.'));
    log.plain('');

    // Require typed confirmation
    if (!opts.yes) {
      const promptFn = d.promptConfirmation ?? (async (name: string, id: string) => {
        log.plain(chalk.bold('Type the exact app name or app ID to confirm deletion:'));
        return input({ message: `Confirm by typing "${name}" or "${id}":` });
      });

      const confirmation = (await promptFn(appName, appId)).trim();
      if (confirmation !== appName && confirmation !== appId) {
        log.warn('Confirmation did not match — deletion cancelled.');
        return 0;
      }
    }

    // Delete the remote app
    log.step('Deleting Marketplace app...');
    await deleteApp({ env, appId, creds: creds.creds });
    log.success('Marketplace app deleted successfully.');

    // Update local project state
    await updateProjectState(dir, {
      appId: undefined,
      lastDevUrl: undefined,
      syncedDevUrl: undefined,
    });
    log.success('Project unlinked from the deleted app.');

    log.plain('');
    log.plain('  Local project files were preserved:');
    log.plain(`    ${dir}`);
    log.dim('  To delete the local project, use `zoom project delete`.');

    return 0;
  } catch (err) {
    log.error('App deletion failed:');
    log.plain(formatError(err, 'Delete App'));
    log.plain('');
    log.dim('  The local project was not modified.');
    log.dim('  If the deletion request was ambiguous (network error, timeout), verify');
    log.dim('  the app status in the Marketplace dashboard before retrying.');
    return 1;
  }
}
