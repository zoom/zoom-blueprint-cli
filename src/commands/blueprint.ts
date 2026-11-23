import fs from 'node:fs/promises';
import path from 'node:path';
import { input, confirm, select, checkbox } from '@inquirer/prompts';
import { TEMPLATES, listTemplates, getTemplate } from '../templates/registry.js';
import { DEFINITION_FILE, relativeFile, parseDefinition, validateSample, validBlueprintId, type BlueprintDefinition } from '../templates/definition.js';
import { inspectRegistration, saveRegistration, removeRegistration, registrationExists } from '../templates/catalog.js';
import { getPath, innerManifest } from '../manifest/resolve.js';
import { log } from '../util/logger.js';

export interface RegisterOptions { yes?: boolean; }
export interface RegisterDeps {
  ask?: (message: string, initial: string) => Promise<string>;
  confirm?: (message: string) => Promise<boolean>;
  choose?: (message: string, choices: string[]) => Promise<string>;
  requiredEnv?: (names: string[]) => Promise<string[]>;
}
const ask = (message: string, initial: string) => input({ message, default: initial, validate: value => !!value.trim() || 'Enter a value.' });

async function detectManifest(folder: string): Promise<string> {
  for (const file of ['0-app-manifest/app-manifest.json', 'zoom-manifest.json', 'manifest.json']) {
    try { await fs.access(path.join(folder, file)); return file; } catch { /* Try the next conventional location. */ }
  }
  return '';
}
async function guidedDefinition(folder: string, deps: RegisterDeps): Promise<BlueprintDefinition> {
  const prompt = deps.ask ?? ask;
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const basename = path.basename(folder).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = await prompt('Blueprint ID', /^[a-z]/.test(basename) ? basename : 'my-blueprint');
  const name = await prompt('Display name', pkg.name || basename);
  const description = await prompt('What does this sample demonstrate?', pkg.description || '');
  const manifestPath = await prompt('General App manifest path', await detectManifest(folder));
  relativeFile(manifestPath, 'Manifest path');
  const scripts = Object.keys(pkg.scripts ?? {});
  if (!scripts.length) throw new Error('Add a package.json script that starts the sample before registering it.');
  const candidates = ['dev', 'start', ...scripts].filter((value, i, all) => scripts.includes(value) && all.indexOf(value) === i);
  const script = await (deps.choose ?? ((message, choices) => select({ message, choices: choices.map(value => ({ value, name: `npm run ${value}` })) })))('Development script', candidates);
  const example = await fs.readFile(path.join(folder, '.env.example'), 'utf8');
  const names = [...new Set([...example.matchAll(/^\s*#?\s*([A-Z_][A-Z0-9_]*)\s*=/gm)].map(m => m[1]))].filter(name => name !== 'NGROK_AUTHTOKEN' && name !== 'ZOOM_PUBLIC_CLIENT_ID' && !name.startsWith('ZOOM_S2S_'));
  const portVariables = names.filter(name => /(?:^|_)PORT$/.test(name)).sort((a,b) => Number(b === 'FRONTEND_PORT') - Number(a === 'FRONTEND_PORT'));
  const portEnv = portVariables.length > 1
    ? await (deps.choose ?? ((message, choices) => select({message,choices:choices.map(value=>({value,name:value}))})))('Public server port variable', portVariables)
    : portVariables[0];
  const initialPort = portEnv ? example.match(new RegExp('^\\s*' + portEnv + '\\s*=\\s*([0-9]+)', 'm'))?.[1] : undefined;
  const port = Number(await prompt('Local development port', initialPort || '3000'));
  const readinessPath = await prompt('Readiness endpoint', '/health');
  const installScript = scripts.includes('install:all') ? ['npm run install:all', 'npm install'] : ['npm install'];
  const install = await (deps.choose ?? ((message, choices) => select({ message, choices: choices.map(value => ({ value, name: value })) })))('Dependency installation command', installScript);
  const requiredEnv = await (deps.requiredEnv ?? (choices => checkbox({ message: 'Required runtime values (leave optional integrations unchecked)', choices: choices.map(value => ({ value, name: value })) })))(names);
  const inner = innerManifest(JSON.parse(await fs.readFile(path.join(folder, manifestPath), 'utf8')));
  const mappings: { path: string; route: string; label: string }[] = [];
  const paths = ['oauth_information.development_redirect_uri', 'features.development_home_uri', 'features.team_chat_subscription.slash_command.development_message_url'];
  for (const [i] of (inner.oauth_information?.oauth_allow_list ?? []).entries()) paths.push(`oauth_information.oauth_allow_list.${i}`);
  for (const [i] of (inner.features?.event_subscription?.events ?? []).entries()) paths.push(`features.event_subscription.events.${i}.development_webhook_url`);
  for (const key of paths) {
    const value = getPath(inner, key);
    if (typeof value !== 'string') continue;
    const change = await (deps.confirm ?? (message => confirm({ message, default: true })))(`Update ${key} when the development URL changes?`);
    if (change) {
      let initial = '/';
      try { initial = new URL(value.replace('{{DEV_BASE_URL}}', 'https://example.invalid')).pathname; } catch { /* The developer supplies the actual route. */ }
      mappings.push({ path: key, route: await prompt(`Route for ${key}`, initial), label: key });
    }
  }
  const dependencyDirs = ['.'];
  for (const entry of await fs.readdir(folder, {withFileTypes:true})) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
    try { await fs.access(path.join(folder, entry.name, 'package.json')); dependencyDirs.push(entry.name); } catch { /* Not a package directory. */ }
  }
  const reconcile: NonNullable<BlueprintDefinition['reconcile']> = { urlVars: [] };
  for (const name of names.filter(name => /(?:REDIRECT_URI|SITE_URL|PUBLIC_BASE_URL|WEBVIEW_URL|FRONTEND_ORIGIN)$/.test(name))) {
    if (await (deps.confirm ?? (message => confirm({ message, default: true })))(`Update ${name} from the development URL?`)) {
      const route = await prompt(`Route for ${name} (use / for the origin)`, name.includes('REDIRECT') ? '/auth/callback' : '/');
      reconcile.urlVars!.push({ name, ...(route === '/' ? { kind: 'origin' as const } : { route }), label: name });
    }
  }
  return parseDefinition({ schemaVersion: 1, id, name, description, manifestPath, requiredEnv,
    setupCommands: [install], startCommands: [`npm run ${script}`], reconcile,
    runtime: { kind: 'server', devCommand: ['npm', 'run', script], dependencyDirs, defaultPort: port, readinessPath,
      ...(portEnv ? { portEnv } : {}), urlMappings: mappings } });
}

export async function blueprintRegister(folder: string, opts: RegisterOptions = {}, deps: RegisterDeps = {}): Promise<number> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(folder)) throw new Error('Register a local folder. Clone the repository first, then run zoom blueprint register <folder>.');
  const root = await fs.realpath(path.resolve(folder));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Register a local sample folder.');
  let definition: BlueprintDefinition;
  let text: string | undefined;
  try { text = await fs.readFile(path.join(root, DEFINITION_FILE), 'utf8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  if (text !== undefined) definition = parseDefinition(JSON.parse(text));
  else if (opts.yes) throw new Error('Noninteractive registration requires zoom-blueprint.json. Run zoom blueprint register <folder> once interactively, then export its definition with zoom blueprint inspect <id> --json.');
  else definition = await guidedDefinition(root, deps);
  if (TEMPLATES.some(t => t.id === definition.id)) throw new Error(`"${definition.id}" is a bundled blueprint ID. Choose a unique ID.`);
  if (registrationExists(definition.id)) throw new Error(`Blueprint "${definition.id}" is already registered. Unregister it before replacing its snapshot.`);
  definition = validateSample(root, definition);
  log.heading('Register blueprint');
  log.plain(`  ${definition.name} (${definition.id})\n  ${definition.description}\n`);
  log.plain(`  Source:   ${root}\n  Install:  ${definition.setupCommands.join(' && ')}\n  Start:    ${definition.runtime!.devCommand.join(' ')}\n  Port:     ${definition.runtime!.defaultPort}\n  Health:   ${definition.runtime!.readinessPath}`);
  log.plain(`  Scopes:   ${definition.requiredScopes.join(', ') || '(none)'}\n  Required: ${definition.requiredEnv.join(', ') || '(none)'}`);
  for (const mapping of definition.runtime!.urlMappings ?? []) log.plain(`  URL:      ${mapping.label || mapping.path} → <development-url>${mapping.route || ''}`);
  if (definition.supportedProviders.length) log.plain('  AI declarations are metadata; registration does not verify inference.');
  log.plain('  Known private files and build/dependency folders are excluded. Review source for embedded secrets.\n');
  if (!opts.yes && !await (deps.confirm ?? (message => confirm({ message, default: true })))('Save this local blueprint snapshot?')) { log.warn('Cancelled — blueprint not registered.'); return 0; }
  const registered = await saveRegistration(root, definition);
  log.success(`Registered ${definition.id} (${registered.fileCount} files).`);
  log.plain(`  Snapshot SHA-256: ${registered.sha256}\n\n  Next:\n    zoom create --name my-demo --template ${definition.id}\n`);
  return 0;
}
export async function blueprintList(): Promise<number> {
  log.heading('Blueprints');
  for (const t of listTemplates()) log.plain(`  ${t.id} — ${t.name} (${t.source.type === 'registered' ? 'local registration' : 'bundled'})`);
  return 0;
}
export async function blueprintInspect(id: string, opts: { json?: boolean } = {}): Promise<number> {
  if (!validBlueprintId(id)) throw new Error('Invalid blueprint ID.');
  const t = getTemplate(id);
  if (!t) throw new Error(`Unknown blueprint "${id}". Run zoom blueprint list.`);
  const { source, compatibleAppTypes: _types, ...metadata } = t;
  const d = { schemaVersion: 1, ...metadata };
  if (opts.json) { log.plain(JSON.stringify(d, null, 2)); return 0; }
  log.heading(t.name); log.plain(`  ID: ${id}\n  ${t.description}`);
  log.plain(`  Type: ${source.type === 'registered' ? 'local registration' : 'bundled'}\n  Install: ${t.setupCommands.join(' && ')}\n  Start: ${t.runtime?.devCommand.join(' ') ?? t.startCommands.join(' && ')}`);
  if (source.type === 'registered') {
    const { registration } = inspectRegistration(id);
    log.plain(`  Original folder: ${registration.sourceFolder}\n  Registered: ${registration.registeredAt}\n  Snapshot SHA-256: ${registration.sha256}`);
  }
  log.plain(`\n  Export definition:\n    zoom blueprint inspect ${id} --json\n`);
  return 0;
}
export async function blueprintUnregister(id: string, opts: { yes?: boolean } = {}, deps: Pick<RegisterDeps, 'confirm'> = {}): Promise<number> {
  if (TEMPLATES.some(t => t.id === id)) throw new Error('Bundled blueprints cannot be unregistered.');
  if (!registrationExists(id)) throw new Error(`Blueprint "${id}" is not registered locally.`);
  if (!opts.yes && !await (deps.confirm ?? (message => confirm({ message, default: false })))(`Remove the saved blueprint snapshot "${id}"? Generated projects and Marketplace apps will remain.`)) { log.warn('Cancelled.'); return 0; }
  await removeRegistration(id); log.success(`Unregistered ${id}. Existing projects and Marketplace apps are unchanged.`); return 0;
}
