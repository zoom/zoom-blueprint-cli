import { saveSession, removeSession } from '../../src/auth/store.js';
import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run } from '../../src/cli.js';
import { appCreate } from '../../src/commands/app-create.js';
import { readProjectState } from '../../src/config/project-state.js';
import { makeProject, validManifest } from '../helpers/project.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await removeSession('prod'); await cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const creds = () => ({ ok: true, creds: { accountId: 'account', clientId: 'management', clientSecret: 'management-secret' }, missing: [] });

it('creates a HITL app with its own slash command, saves the link, and defers credential setup until zoom dev', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hitl-marketplace-'));
  cleanup = () => fs.rm(tmp, { recursive: true, force: true });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [key, value] of Object.entries({ ZOOM_S2S_ACCOUNT_ID: 'account', ZOOM_S2S_CLIENT_ID: 'management', ZOOM_S2S_CLIENT_SECRET: 'secret' })) vi.stubEnv(key, value);
  await saveSession({version:1,environment:'prod',clientId:'public-id',accessToken:'mock-token',refreshToken:'r',expiresAt:Date.now()+3600000,scopes:[]});
  const submitted: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'mock-token' }));
    expect(options.method).toBe('POST');
    expect(url).toBe('https://api.zoom.us/v2/marketplace/apps');
    submitted.push(JSON.parse(options.body as string));
    return new Response(JSON.stringify({ app_id: 'HITL-NEW', credentials: { client_id: 'app-client', client_secret: 'app-secret' } }), { status: 201 });
  }));
  expect(await run({ name: 'meeting-live', template: 'hitl-workplace-agent', appType: 'general', env: 'prod', outDir: tmp, yes: true })).toBe(0);
  const command = submitted[0].manifest.features.team_chat_subscription.slash_command.command;
  expect(command).toMatch(/^meetinglive[a-f0-9]{8}$/);
  const dir = path.join(tmp, 'meeting-live');
  expect((await readProjectState(dir)).appId).toBe('HITL-NEW');
  expect(await fs.readFile(path.join(dir, '.env'), 'utf8')).toContain('ZOOM_CLIENT_SECRET=app-secret');
  const output = log.mock.calls.flat().join('\n');
  expect(output).not.toContain('/features/surface?mode=dev');
  expect(output).not.toContain('/features/access?mode=dev');
  expect(output).toContain('Run zoom dev');
  expect(output).not.toContain('Run zoom configure');
  expect(output.match(/Zoom Marketplace app created/g)).toHaveLength(1);
  expect(output).not.toContain('app-secret');
});

it('repairs the old HITL command and resumes creation without replacing the existing project', async () => {
  const manifest = validManifest();
  manifest.manifest.features.team_chat_subscription = { slash_command: { command: 'zwc' } };
  const project = await makeProject({ state: { templateId: 'hitl-workplace-agent' }, manifest, env: { OPENAI_API_KEY: 'preserve-me' } });
  cleanup = project.cleanup;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const create = vi.fn(async (args) => {
    expect(args.manifest.manifest.features.team_chat_subscription.slash_command.command).not.toBe('zwc');
    return { status: 'success' as const, appId: 'RESUMED', clientId: 'runtime-id', clientSecret: 'runtime-secret' };
  });
  expect(await appCreate({ yes: true }, { cwd: project.dir, getCreds: creds, create })).toBe(0);
  const env = await fs.readFile(path.join(project.dir, '.env'), 'utf8');
  expect(env).toContain('OPENAI_API_KEY=preserve-me');
  expect(env).toContain('ZOOM_CLIENT_SECRET=runtime-secret');
  expect((await readProjectState(project.dir)).appId).toBe('RESUMED');
  await expect(appCreate({ yes: true }, { cwd: project.dir, getCreds: creds, create })).rejects.toThrow(/already linked/);
  expect(create).toHaveBeenCalledTimes(1);
});

it('keeps a failed resume unlinked and never prints a success link', async () => {
  const project = await makeProject({ state: { templateId: 'hitl-workplace-agent' }, manifest: validManifest() });
  cleanup = project.cleanup;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await appCreate({ yes: true }, { cwd: project.dir, getCreds: creds, create: async () => { throw new Error('invalid_manifest'); } })).toBe(1);
  expect((await readProjectState(project.dir)).appId).toBeUndefined();
  expect(log.mock.calls.flat().join('\n')).not.toContain('created and linked');
});
