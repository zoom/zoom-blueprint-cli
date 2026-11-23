import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Template } from './registry.js';
import { parseDefinition, validateSample, validBlueprintId, DEFINITION_FILE, type BlueprintDefinition } from './definition.js';

export function blueprintDirectory(): string {
  return process.env.ZOOM_BLUEPRINT_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zoom-agent', 'blueprints');
}
export interface Registration {
  schemaVersion: 1;
  registeredAt: string;
  sourceFolder: string;
  sha256: string;
  fileCount: number;
}
const skipped = new Set(['node_modules', '.git', '.claude', '.vscode', '.idea', '.hg', '.svn', '.DS_Store', '.next', 'out', 'build', 'dist', 'coverage', '.vercel', '.turbo', '__pycache__', '.venv', '.pytest_cache', '.npmrc', '.netrc', '.pypirc', '.ssh', '.aws', '.config', '.zoom-agent.json', '.registration.json']);
/** Known private files and generated artifacts never enter a registration or scaffold. */
export function excludedBlueprintFile(name: string): boolean {
  return skipped.has(name) || (name.startsWith('.env') && !/^\.env(?:\.[\w-]+)?\.example$/.test(name)) || /^\.yarnrc/.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /^(?:credentials|secrets)(?:\.|$)/i.test(name);
}
function entryPath(id: string): string {
  if (!validBlueprintId(id)) throw new Error('Invalid blueprint ID.');
  return path.join(blueprintDirectory(), id);
}
export function registrationExists(id: string): boolean { return fs.existsSync(entryPath(id)); }

export function readRegisteredBlueprints(): Template[] {
  const root = blueprintDirectory();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && validBlueprintId(e.name)).sort((a, b) => a.name.localeCompare(b.name)).map(e => {
    try {
      const d = parseDefinition(JSON.parse(fs.readFileSync(path.join(root, e.name, DEFINITION_FILE), 'utf8')));
      if (d.id !== e.name) throw new Error('ID does not match the registration folder.');
      const { schemaVersion: _version, ...metadata } = d;
      return { ...metadata, compatibleAppTypes: ['general'], source: { type: 'registered', directory: path.join(root, e.name, 'files') } } as Template;
    } catch {
      throw new Error(`Registered blueprint "${e.name}" is invalid. Run zoom blueprint unregister ${e.name}, then register its source folder again.`);
    }
  });
}
export function inspectRegistration(id: string): { definition: BlueprintDefinition; registration: Registration } {
  const folder = entryPath(id);
  return { definition: parseDefinition(JSON.parse(fs.readFileSync(path.join(folder, DEFINITION_FILE), 'utf8'))), registration: JSON.parse(fs.readFileSync(path.join(folder, '.registration.json'), 'utf8')) };
}

async function copySnapshot(source: string, destination: string, hash: ReturnType<typeof createHash>): Promise<number> {
  let count = 0;
  for (const name of (await fsp.readdir(source)).sort()) {
    if (excludedBlueprintFile(name) || name === DEFINITION_FILE) continue;
    const from = path.join(source, name), to = path.join(destination, name);
    const stat = await fsp.lstat(from);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in blueprints: ${from}. Copy the intended file into the sample instead.`);
    hash.update(name + '\0');
    if (stat.isDirectory()) {
      hash.update('directory\0'); await fsp.mkdir(to);
      count += await copySnapshot(from, to, hash);
      hash.update('end\0');
    } else if (stat.isFile()) {
      const data = await fsp.readFile(from);
      hash.update('file\0' + (stat.mode & 0o111) + '\0' + data.length + '\0'); hash.update(data);
      await fsp.writeFile(to, data, { mode: stat.mode & 0o111 ? 0o755 : 0o644 }); count++;
    } else throw new Error(`Unsupported sample file: ${from}.`);
  }
  return count;
}

/** Resolve existing parent symlinks even when the catalog directory has not been created yet. */
async function canonicalTarget(target: string): Promise<string> {
  try { return await fsp.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.join(await canonicalTarget(path.dirname(target)), path.basename(target));
  }
}

/** Registration never executes commands, installs packages, or calls Marketplace. */
export async function saveRegistration(sourceFolder: string, definition: BlueprintDefinition): Promise<Registration> {
  const source = await fsp.realpath(sourceFolder);
  const root = await canonicalTarget(path.resolve(blueprintDirectory()));
  const relative = path.relative(source, root);
  if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('Choose a sample folder that does not contain the blueprint storage directory.');
  const d = validateSample(source, definition);
  const destination = entryPath(d.id);
  if (registrationExists(d.id)) throw new Error(`Blueprint "${d.id}" is already registered. Unregister it before replacing its snapshot.`);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const staging = path.join(root, '.register-' + randomUUID());
  try {
    await fsp.mkdir(path.join(staging, 'files'), { recursive: true, mode: 0o700 });
    const hash = createHash('sha256'); hash.update(JSON.stringify(d));
    const fileCount = await copySnapshot(source, path.join(staging, 'files'), hash);
    // Validate the copied files, not only the original folder (excluded paths must not be required).
    validateSample(path.join(staging, 'files'), d);
    const json = JSON.stringify(d, null, 2) + '\n';
    await fsp.writeFile(path.join(staging, DEFINITION_FILE), json, { mode: 0o600 });
    await fsp.writeFile(path.join(staging, 'files', DEFINITION_FILE), json, { mode: 0o644 });
    const registration: Registration = { schemaVersion: 1, sourceFolder: source, registeredAt: new Date().toISOString(), sha256: hash.digest('hex'), fileCount: fileCount + 1 };
    await fsp.writeFile(path.join(staging, '.registration.json'), JSON.stringify(registration, null, 2) + '\n', { mode: 0o600 });
    await fsp.rename(staging, destination);
    return registration;
  } finally { await fsp.rm(staging, { recursive: true, force: true }); }
}
export async function removeRegistration(id: string): Promise<void> {
  const folder = entryPath(id);
  if (!registrationExists(id)) throw new Error(`Blueprint "${id}" is not registered locally.`);
  const stat = await fsp.lstat(folder);
  if (stat.isSymbolicLink()) throw new Error('Refusing to remove a symbolic link registration.');
  await fsp.rm(folder, { recursive: true });
}
