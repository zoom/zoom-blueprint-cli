import type { BlueprintDefinition } from '../templates/definition.js';
import type { AppInfo } from '../types.js';
// Project state: the reliable link between a generated project and its Zoom Marketplace app +
// template. Written into the scaffolded project as `.zoom-agent.json` by the create flow, and read
// by `zoom dev` / `zoom app *` / `zoom doctor` so they operate on the right template, app type, and
// app id without re-prompting. Contains NO secrets — only the non-secret Marketplace app id.

import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from '../util/errors.js';
import type { AppType } from '../templates/registry.js';
import type { MarketplaceFailure } from '../util/marketplace-status.js';
import type { ProviderId } from '../providers.js';

export const STATE_FILE = '.zoom-agent.json';

export interface ProjectState {
  version: 1;
  projectName: string;
  /** Non-secret developer contact information used by the Create App API. */
  appInfo?: AppInfo;
  templateId: string;
  /** Portable configuration for a locally registered blueprint; contains no source machine path. */
  blueprint?: BlueprintDefinition;
  appType: AppType;
  /** Legacy selection. Feature routing is defined by the template. */
  provider?: ProviderId;
  /** Zoom environment the app lives in: 'dev' | 'prod'. */
  env: string;
  marketplaceSetup: 'auto' | 'manual';
  /** Relative path (within the project) to the canonical manifest, if the template has one. */
  manifestPath?: string;
  /** Created Marketplace app id (non-secret). Absent until an app is created/linked. */
  appId?: string;
  /** Last failed provisioning or URL sync, sanitized for display on the next run. */
  marketplaceFailure?: MarketplaceFailure;
  /** Dev-tunnel URL last used, so a hostname change can be detected (non-secret). */
  lastDevUrl?: string;
  /** Dev URL that was last successfully synchronized to the Marketplace app (non-secret). */
  syncedDevUrl?: string;
  /** URL mode: 'ngrok' or 'custom' (how the development URL is provided). */
  urlMode?: 'ngrok' | 'custom';
  /** Auto-sync permission: allow automatic manifest updates when development URLs change. */
  autoSyncDevUrls?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export async function writeProjectState(dir: string, state: ProjectState): Promise<string> {
  const p = path.join(dir, STATE_FILE);
  await fs.writeFile(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return p;
}

export async function readProjectState(dir: string): Promise<ProjectState> {
  const p = path.join(dir, STATE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(
        `No ${STATE_FILE} found in ${dir}. Run this command from inside a project created by ` +
          '`create-zoom-agent` (or `cd` into one).',
      );
    }
    throw err;
  }
  let parsed: ProjectState;
  try {
    parsed = JSON.parse(raw) as ProjectState;
  } catch {
    throw new CliError(`${p} is not valid JSON. It may be corrupt — recreate the project or fix it by hand.`);
  }
  if (!parsed.templateId || !parsed.appType) {
    throw new CliError(`${p} is missing required fields (templateId / appType).`);
  }
  if (parsed.appType !== 'general') {
    throw new CliError(`Unsupported project app type "${parsed.appType}". This CLI supports General Apps only. Create a new General App project; the existing files have not been changed.`);
  }
  return parsed;
}

/** Walk up from startDir to find the project root containing STATE_FILE. Returns dir or null. */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string | null> {
  let dir = path.resolve(startDir);
  // Bound the walk at the filesystem root.
  for (;;) {
    try {
      await fs.access(path.join(dir, STATE_FILE));
      return dir;
    } catch {
      /* not here — go up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Find the nearest project root and read its state, or throw a clear error. */
export async function loadProjectState(startDir: string = process.cwd()): Promise<{ dir: string; state: ProjectState }> {
  const dir = await findProjectRoot(startDir);
  if (!dir) {
    throw new CliError(
      `Not inside a Zoom agent project (no ${STATE_FILE} found here or in any parent directory).`,
    );
  }
  return { dir, state: await readProjectState(dir) };
}

/** Merge a patch into an existing state file (stamps updatedAt). */
export async function updateProjectState(
  dir: string,
  patch: Partial<ProjectState>,
  now: () => string = () => new Date().toISOString(),
): Promise<ProjectState> {
  const current = await readProjectState(dir);
  const merged: ProjectState = { ...current, ...patch, updatedAt: now() };
  await writeProjectState(dir, merged);
  return merged;
}
