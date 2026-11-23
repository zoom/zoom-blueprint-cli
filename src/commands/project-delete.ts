// `zoom project delete` — safe local project deletion with strong safeguards.

import fs from 'node:fs/promises';
import path from 'node:path';
import { input } from '@inquirer/prompts';
import { loadProjectState } from '../config/project-state.js';
import { CliError, formatError } from '../util/errors.js';
import { log, chalk } from '../util/logger.js';

export interface ProjectDeleteDeps {
  cwd?: string;
  /** Override confirmation prompt (tests only). */
  promptConfirmation?: (projectName: string, projectPath: string) => Promise<string>;
  /** Override directory removal (tests only). */
  removeDir?: (dir: string) => Promise<void>;
}

export interface ProjectDeleteOpts {
  /** Skip the typed confirmation (DANGEROUS - only for tests). */
  yes?: boolean;
}

/**
 * Delete a local project directory with strong safeguards. Never deletes the remote Marketplace app.
 */
export async function projectDelete(opts: ProjectDeleteOpts = {}, d: ProjectDeleteDeps = {}): Promise<number> {
  const cwd = d.cwd ?? process.cwd();

  try {
    // Load project state to verify this is a managed project
    const { dir, state } = await loadProjectState(cwd);
    const projectName = state.projectName;
    const projectPath = dir;

    // Safety checks: refuse to delete dangerous paths
    if (isCriticalPath(projectPath)) {
      throw new CliError(
        `Refusing to delete a critical system path: ${projectPath}\n` +
        '  This appears to be a system directory, user home, or the CLI package itself.'
      );
    }

    if (isInsideNodeModules(projectPath)) {
      throw new CliError(
        `Refusing to delete a path inside node_modules: ${projectPath}\n` +
        '  This project appears to be inside a dependency tree.'
      );
    }

    // Check if project is linked to a Marketplace app
    const hasLinkedApp = !!state.appId;

    log.heading('Delete Local Project');
    log.plain(`  Project: ${projectName}`);
    log.plain(`  Path:    ${projectPath}`);
    log.plain('');

    if (hasLinkedApp) {
      log.plain(chalk.yellow('⚠️  This project is linked to a Marketplace app.'));
      log.plain('');
      log.plain('  The Marketplace app will NOT be deleted.');
      log.plain(`  App ID: ${state.appId}`);
      log.plain('  To delete the Marketplace app, run `zoom app delete` first.');
      log.plain('');
    }

    log.plain(chalk.red('⚠️  WARNING: This will permanently delete all local project files.'));
    log.plain('');
    log.plain('  What will be deleted:');
    log.plain('    • All source code');
    log.plain('    • Configuration files (.env, .zoom-agent.json)');
    log.plain('    • node_modules (if present)');
    log.plain('    • All project history and uncommitted work');
    log.plain('');
    log.plain('  What will NOT be deleted:');
    log.plain('    • The Zoom Marketplace app (if linked)');
    log.plain('    • Any files outside this project directory');
    log.plain('');

    // Require typed confirmation
    if (!opts.yes) {
      const promptFn = d.promptConfirmation ?? (async (name: string) => {
        log.plain(chalk.bold('Type the exact project name to confirm deletion:'));
        return input({ message: `Confirm by typing "${name}":` });
      });

      const confirmation = (await promptFn(projectName, projectPath)).trim();
      if (confirmation !== projectName) {
        log.warn('Confirmation did not match — deletion cancelled.');
        return 0;
      }
    }

    // Delete the directory
    log.step('Deleting project directory...');
    const removeDir = d.removeDir ?? (async (dir: string) => {
      await fs.rm(dir, { recursive: true, force: true });
    });
    await removeDir(projectPath);
    log.success('Project deleted successfully.');

    log.plain('');
    log.plain('  The local project has been permanently removed.');
    if (hasLinkedApp) {
      log.dim('  The Marketplace app was preserved — delete it separately with `zoom app delete`.');
    }

    return 0;
  } catch (err) {
    if ((err as any).message?.includes('Not inside a Zoom agent project')) {
      log.error('Not inside a Zoom agent project.');
      log.dim('  Run this command from inside a project created by create-zoom-agent.');
      return 1;
    }
    log.error('Project deletion failed:');
    log.plain(formatError(err, 'Delete Project'));
    return 1;
  }
}

/** Check if a path is a critical system directory that should never be deleted. */
function isCriticalPath(p: string): boolean {
  const normalized = path.normalize(p);
  const critical = [
    '/',
    '/home',
    '/root',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/var',
    '/System',
    '/Applications',
    '/Library',
    '/Users',
    '/Windows',
    '/Program Files',
  ];

  // Check if path is a critical directory
  if (critical.some(c => normalized === c || normalized === path.normalize(c))) {
    return true;
  }

  // Check if path is user home or parent
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    const normalizedHome = path.normalize(home);
    if (normalized === normalizedHome || normalized === path.dirname(normalizedHome)) {
      return true;
    }
  }

  // Check if path looks like the CLI package itself
  if (normalized.includes('create-zoom-agent') && normalized.includes('node_modules')) {
    return true;
  }

  return false;
}

/** Check if a path is inside node_modules (a generated project path, not a dependency). */
function isInsideNodeModules(p: string): boolean {
  const parts = path.normalize(p).split(path.sep);
  return parts.includes('node_modules');
}
