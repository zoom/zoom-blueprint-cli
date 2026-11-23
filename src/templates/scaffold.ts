import { excludedBlueprintFile } from './catalog.js';
// Template scaffolding: copy a local template (or fetch a pinned GitHub tarball) into the project
// directory, then replace placeholder tokens. No `git clone` / no `.git` history is ever copied.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar';
import type { Template, TemplateSource } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Package root is two levels up from dist/src templates dir at runtime; resolve the bundled
// `templates/` folder relative to this module. In dev (tsx) __dirname is src/templates → ../../templates.
// After build (dist/templates/scaffold.js) it is dist/templates → ../../templates (package root).
const PACKAGE_TEMPLATES_DIR = path.resolve(__dirname, '../../templates');

/** Files/dirs never copied from a template (build artifacts, VCS, caches). */
const IGNORED = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  '.next',
  'out',
  'build',
  'dist',
  'coverage',
  '.vercel',
  '.turbo',
  '__pycache__',
  '.venv',
  '.pytest_cache',
]);

export interface ScaffoldVars {
  [key: string]: string;
}

/**
 * Scaffold `template` into `destDir`. Returns the list of relative file paths written.
 * Throws if destDir exists and is non-empty (caller handles that case).
 */
export async function scaffoldTemplate(
  template: Template,
  destDir: string,
  vars: ScaffoldVars,
): Promise<string[]> {
  await assertEmptyDest(destDir);
  const sourceDir = await materializeSource(template.source);
  try {
    await fs.mkdir(destDir, { recursive: true });
    const written = await copyDir(sourceDir, destDir, vars);
    return written;
  } finally {
    // Clean up a temp dir used for GitHub downloads (local sources leave sourceDir untouched).
    if (template.source.type === 'github') {
      await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function assertEmptyDest(destDir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(destDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // doesn't exist → fine
    throw err;
  }
  const meaningful = entries.filter((e) => e !== '.DS_Store');
  if (meaningful.length > 0) {
    throw new Error(`Destination "${destDir}" already exists and is not empty. Choose a new name or remove it.`);
  }
}

/** Resolve a template source to a local directory (downloading a GitHub tarball if needed). */
async function materializeSource(source: TemplateSource): Promise<string> {
  if (source.type === 'registered') {
    await fs.access(source.directory);
    return source.directory;
  }
  if (source.type === 'local') {
    const dir = path.join(PACKAGE_TEMPLATES_DIR, source.directory);
    try {
      await fs.access(dir);
    } catch {
      throw new Error(`Bundled template not found at ${dir}. The CLI install may be corrupt.`);
    }
    return dir;
  }
  return fetchGithubTemplate(source);
}

/**
 * Download a repo tarball at a pinned ref and extract ONLY the template subdirectory (strips the
 * `<repo>-<ref>/<directory>/` prefix). No git history is retained. Returns the extracted dir.
 */
async function fetchGithubTemplate(source: {
  repo: string;
  ref: string;
  directory: string;
}): Promise<string> {
  const [owner, repo] = source.repo.split('/');
  if (!owner || !repo) throw new Error(`Invalid template repo "${source.repo}" (expected owner/repo).`);
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(source.ref)}`;

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    const err = new Error(`Template download failed: HTTP ${res.status} for ${url}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-agent-tpl-'));
  // Strip "<repo>-<ref>/<directory>/" → extract the template subtree into tmp.
  const stripDepth = 1 + source.directory.split('/').filter(Boolean).length;
  const filterPrefix = `${repo}-${source.ref}/${source.directory}/`;

  await pipeline(
    // Web ReadableStream is accepted by Node's stream pipeline at runtime.
    res.body as unknown as NodeJS.ReadableStream,
    createGunzip(),
    tar.extract({
      cwd: tmp,
      strip: stripDepth,
      filter: (p: string) => p.startsWith(filterPrefix),
    }),
  );
  return tmp;
}

/** Recursively copy sourceDir → destDir, applying placeholder replacement to text files. */
async function copyDir(sourceDir: string, destDir: string, vars: ScaffoldVars): Promise<string[]> {
  const written: string[] = [];
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || excludedBlueprintFile(entry.name)) continue;
    if (entry.name === '.gitignore' && entries.some(file => file.name === 'gitignore')) continue;
    const src = path.join(sourceDir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Template symbolic links are not supported: ${src}`);
    // A template ships `gitignore` (no dot) so npm doesn't strip it on publish; restore the dot.
    const destName = entry.name === 'gitignore' ? '.gitignore' : entry.name;
    const dest = path.join(destDir, destName);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      written.push(...(await copyDir(src, dest, vars)));
    } else {
      const text = await fs.readFile(src);
      if (isBinary(text)) {
        await fs.writeFile(dest, text);
      } else {
        await fs.writeFile(dest, replacePlaceholders(text.toString('utf8'), vars), 'utf8');
      }
      const mode = (await fs.stat(src)).mode;
      if (mode & 0o111) await fs.chmod(dest, 0o755);
      written.push(dest);
    }
  }
  return written;
}

/** Replace `{{TOKEN}}` occurrences; unknown tokens are left intact. */
export function replacePlaceholders(fileText: string, vars: ScaffoldVars): string {
  return fileText.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in vars ? vars[k] : `{{${k}}}`));
}

// Heuristic binary check: a NUL byte in the first 8KB.
function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
