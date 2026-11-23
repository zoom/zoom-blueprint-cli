// Registered blueprints reuse the bundled Template contract; only source storage differs.
import fs from 'node:fs';
import path from 'node:path';
import type { Template } from './registry.js';
import { innerManifest, getPath } from '../manifest/resolve.js';
import { localManifestIssues } from '../manifest/project.js';

export type BlueprintDefinition = Omit<Template, 'source' | 'compatibleAppTypes'> & { schemaVersion: 1 };
export const DEFINITION_FILE = 'zoom-blueprint.json';
export const validBlueprintId = (id: string): boolean => typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64;
const envName = /^[A-Z_][A-Z0-9_]*$/;
const surfaces = ['team_chat', 'zoom_app', 'meeting', 'rtms', 'account_api', 'contact_center'];
const unsafeSegments = new Set(['__proto__', 'prototype', 'constructor']);

export function relativeFile(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some(s => s === '..' || unsafeSegments.has(s))) {
    throw new Error(`${label} must be a relative path inside the sample folder.`);
  }
}
function route(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\s#?]/.test(value)) throw new Error(`${label} must be a local route such as /health.`);
}
function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`${label} must be an array of nonempty strings.`);
}
function object(value: unknown, label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (unsafeSegments.has(key)) throw new Error(`${label} contains an unsupported key.`);
}
function list(value: unknown, label: string): asserts value is any[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}
function environment(value: unknown, label: string): void {
  if (typeof value !== 'string' || !envName.test(value) || value === 'NGROK_AUTHTOKEN' || value.startsWith('ZOOM_S2S_') || value === 'ZOOM_PUBLIC_CLIENT_ID') throw new Error(`${label} must name an app runtime variable, not CLI configuration.`);
}

/** Validate before any registration write. Provider support is declared, never guessed from packages. */
export function parseDefinition(input: unknown): BlueprintDefinition {
  object(input, DEFINITION_FILE);
  const allowed = new Set(['schemaVersion', 'id', 'name', 'description', 'sourceRepo', 'sourceRef', 'supportedProviders', 'aiMode', 'aiFeatures', 'requiredScopes', 'requiredCapabilities', 'supportedSurfaces', 'providerIntegration', 'claudeCodeSupported', 'products', 'marketplaceSetup', 'manifestPath', 'requiredEnv', 'aiOptionalInDevelopment', 'setupNotes', 'setupCommands', 'startCommands', 'runtime', 'reconcile']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unknown blueprint field: ${key}. See docs/register-blueprint.md.`);
  if (input.schemaVersion !== 1) throw new Error('zoom-blueprint.json requires schemaVersion: 1.');
  if (!validBlueprintId(input.id)) throw new Error('Blueprint id must use lowercase words separated by hyphens (maximum 64 characters).');
  for (const field of ['name', 'description']) if (typeof input[field] !== 'string' || !input[field].trim()) throw new Error(`Blueprint ${field} is required.`);
  const d: any = { supportedProviders: [], aiMode: 'none', aiFeatures: [], requiredScopes: [], requiredCapabilities: [], supportedSurfaces: [], providerIntegration: 'none', claudeCodeSupported: false, products: [], requiredEnv: [], ...input };
  if ('source' in input || 'compatibleAppTypes' in input) throw new Error('Blueprint sources are local folders and app type is General App; omit source and compatibleAppTypes.');
  for (const key of ['supportedProviders', 'requiredScopes', 'requiredCapabilities', 'supportedSurfaces', 'products', 'requiredEnv', 'setupCommands', 'startCommands']) strings(d[key], key);
  if (!d.setupCommands.length || !d.startCommands.length) throw new Error('setupCommands and startCommands must describe installation and startup.');
  for (const key of ['sourceRepo', 'sourceRef']) if (d[key] !== undefined && typeof d[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (d.setupNotes !== undefined) strings(d.setupNotes, 'setupNotes');
  if (typeof d.claudeCodeSupported !== 'boolean' || (d.aiOptionalInDevelopment !== undefined && typeof d.aiOptionalInDevelopment !== 'boolean')) throw new Error('Development feature options must be booleans.');
  for (const name of d.requiredEnv) environment(name, 'requiredEnv');
  if (d.supportedSurfaces.some((s: string) => !surfaces.includes(s))) throw new Error('Unknown supportedSurfaces value.');
  if (!['none', 'fixed', 'feature-specific'].includes(d.aiMode) || !['none', 'sample-native', 'fetch'].includes(d.providerIntegration)) throw new Error('Invalid AI mode or provider integration.');
  list(d.aiFeatures, 'aiFeatures');
  for (const f of d.aiFeatures) {
    object(f, 'AI feature');
    if (!['openai', 'anthropic'].includes(f.provider) || typeof f.name !== 'string' || !f.name.trim() || typeof f.defaultModel !== 'string' || !f.defaultModel.trim()) throw new Error('Each AI feature requires name, provider (openai/anthropic), and defaultModel.');
    environment(f.keyEnv, 'AI keyEnv'); environment(f.modelEnv, 'AI modelEnv');
  }
  const actualProviders = [...new Set(d.aiFeatures.map((f: any) => f.provider))].sort();
  if (JSON.stringify([...new Set(d.supportedProviders)].sort()) !== JSON.stringify(actualProviders) || (d.aiMode === 'none' ? actualProviders.length !== 0 : actualProviders.length === 0) || (d.aiMode === 'fixed' && actualProviders.length !== 1)) throw new Error('supportedProviders and aiMode must match the implemented aiFeatures.');
  if ((d.aiMode === 'none') !== (d.providerIntegration === 'none')) throw new Error('providerIntegration must match the declared AI features.');
  if (d.marketplaceSetup !== undefined && !['auto', 'manual'].includes(d.marketplaceSetup)) throw new Error('marketplaceSetup must be auto or manual.');
  relativeFile(d.manifestPath, 'manifestPath');
  object(d.runtime, 'runtime');
  if (!['server', 'batch', 'docker'].includes(d.runtime.kind)) throw new Error('runtime.kind must be server, batch, or docker.');
  strings(d.runtime.devCommand, 'runtime.devCommand');
  if (!d.runtime.devCommand.length) throw new Error('runtime.devCommand requires an executable and optional arguments.');
  if (!Number.isInteger(d.runtime.defaultPort) || d.runtime.defaultPort < 1 || d.runtime.defaultPort > 65535) throw new Error('runtime.defaultPort must be between 1 and 65535.');
  route(d.runtime.readinessPath, 'runtime.readinessPath');
  for (const key of ['portEnv', 'publicUrlEnv']) if (d.runtime[key] !== undefined) environment(d.runtime[key], `runtime.${key}`);
  if (d.runtime.dependencyDirs !== undefined) { strings(d.runtime.dependencyDirs, 'dependencyDirs'); for (const dir of d.runtime.dependencyDirs) relativeFile(dir, 'dependencyDirs'); }
  for (const field of ['testInstructions']) if (d.runtime[field] !== undefined && typeof d.runtime[field] !== 'string') throw new Error(`runtime.${field} must be a string.`);
  list(d.runtime.urlMappings ?? [], 'runtime.urlMappings');
  for (const m of d.runtime.urlMappings ?? []) {
    object(m, 'URL mapping');
    // Limit mappings to development URL fields; SDK domains and command words are not tunnel URLs.
    if (typeof m.path !== 'string' || !/^(oauth_information\.(development_redirect_uri|oauth_allow_list\.\d+)|features\.(development_home_uri|event_subscription\.events\.\d+\.development_webhook_url|team_chat_subscription\.slash_command\.development_message_url))$/.test(m.path)) throw new Error(`Unsupported development URL mapping: ${String(m.path)}.`);
    if (m.kind !== undefined && m.kind !== 'url') throw new Error('Development mappings must be URLs; SDK domain allow lists must be preserved.');
    if (m.route !== undefined && m.route !== '') route(m.route, 'URL mapping route');
    if (m.label !== undefined && typeof m.label !== 'string') throw new Error('URL mapping label must be a string.');
  }
  if (d.reconcile !== undefined) {
    object(d.reconcile, 'reconcile');
    for (const key of ['urlVars', 'promptVars', 'generateVars']) {
      if (d.reconcile[key] === undefined) continue;
      list(d.reconcile[key], `reconcile.${key}`);
      for (const v of d.reconcile[key]) {
        object(v, key); environment(v.name, key);
        if (v.label !== undefined && typeof v.label !== 'string') throw new Error(`${key}.label must be a string.`);
        if (v.route !== undefined && v.route !== '') route(v.route, key);
        if (v.help !== undefined && typeof v.help !== 'string') throw new Error(`${key}.help must be a string.`);
        if (v.kind !== undefined && !['url', 'origin'].includes(v.kind)) throw new Error('Unknown reconciliation URL kind.');
        if (v.validate !== undefined && !['botJid', 'secretToken'].includes(v.validate)) throw new Error('Unknown prompt validation.');
        if (v.marketplacePage !== undefined && !['surface', 'access'].includes(v.marketplacePage)) throw new Error('Unknown Marketplace page.');
      }
    }
    if (d.reconcile.appNameVar) { object(d.reconcile.appNameVar, 'appNameVar'); environment(d.reconcile.appNameVar.name, 'appNameVar'); }
  }
  return d as BlueprintDefinition;
}

export function validateSample(root: string, definition: BlueprintDefinition): BlueprintDefinition {
  const d = parseDefinition(definition);
  for (const name of ['package.json', '.env.example', 'README.md', d.manifestPath!]) {
    relativeFile(name, 'Sample file');
    const file = path.join(root, name);
    if (!fs.statSync(file).isFile()) throw new Error(`Missing sample file: ${name}.`);
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Sample file escapes the source folder: ${name}.`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!pkg || typeof pkg !== 'object') throw new Error('Invalid package.json.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, d.manifestPath!), 'utf8'));
  const issues = localManifestIssues(manifest, 'general');
  if (issues.length) throw new Error('Invalid General App manifest: ' + issues.join(' '));
  const inner = innerManifest(manifest);
  const scopes = inner.oauth_information?.scopes ?? [];
  if (!Array.isArray(scopes)) throw new Error('Manifest scopes must be an array.');
  const manifestScopes = scopes.map((s: any) => typeof s === 'string' ? s : s?.scope);
  if (manifestScopes.some(s => typeof s !== 'string' || !s)) throw new Error('Manifest scope entries require a scope name.');
  if (d.requiredScopes.length && JSON.stringify([...new Set(d.requiredScopes)].sort()) !== JSON.stringify([...new Set(manifestScopes)].sort())) throw new Error('requiredScopes must match the manifest’s actual OAuth scopes.');
  d.requiredScopes = [...new Set(manifestScopes)];
  for (const m of d.runtime!.urlMappings ?? []) if (typeof getPath(inner, m.path) !== 'string') throw new Error(`URL mapping does not point to a manifest string: ${m.path}.`);
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const names = new Set([...example.matchAll(/^\s*#?\s*([A-Z_][A-Z0-9_]*)\s*=/gm)].map(m => m[1]));
  for (const name of names) if (name === 'NGROK_AUTHTOKEN' || name === 'ZOOM_PUBLIC_CLIENT_ID' || name.startsWith('ZOOM_S2S_')) throw new Error(`${name} belongs in CLI configuration, not the sample .env.example.`);
  for (const name of [...d.requiredEnv, ...d.aiFeatures.flatMap(f => [f.keyEnv, f.modelEnv]), ...(d.reconcile?.urlVars ?? []).map(v => v.name), ...(d.reconcile?.promptVars ?? []).map(v => v.name), ...(d.reconcile?.generateVars ?? []).map(v => v.name), ...(d.reconcile?.appNameVar ? [d.reconcile.appNameVar.name] : [])]) if (!names.has(name)) throw new Error(`${name} is not declared in .env.example.`);
  return d;
}
