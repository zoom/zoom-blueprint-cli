import { saveSession, removeSession } from '../../src/auth/store.js';
// End-to-end CLI runs with mocked Marketplace responses. No live Zoom API is ever called.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { run } from '../../src/cli.js';
import { appDiff, appLink } from '../../src/commands/app.js';
import { readProjectState } from '../../src/config/project-state.js';

const ZOOM_KEYS = [
  'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
  'ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET',
] as const;
let saved: Record<string, string | undefined> = {};
let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  saved = {};
  for (const k of ZOOM_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cza-e2e-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => { await removeSession('prod');
  for (const k of ZOOM_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(tmp, { recursive: true, force: true });
  logSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

describe('offline scaffold (no Marketplace credentials)', () => {
  it('generates a full local project without creating a Marketplace app', async () => {
    const code = await run({
      name: 'test-agent',
      appType: 'general',
      template: 'hitl-workplace-agent',
      outDir: tmp,
      yes: true,
      create: true, // requested, but no creds → falls back to offline
    });
    expect(code).toBe(0);

    const dir = path.join(tmp, 'test-agent');
    expect(await exists(path.join(dir, 'package.json'))).toBe(true);
    expect(await exists(path.join(dir, '.env'))).toBe(true);
    expect(await exists(path.join(dir, '.env.example'))).toBe(true);
    expect(await exists(path.join(dir, '.gitignore'))).toBe(true);

    const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
  });

  it('only registers General App templates', async () => {
    const {compatibleTemplates} = await import('../../src/templates/registry.js');
    expect(compatibleTemplates('general')).toHaveLength(3);
    expect(compatibleTemplates('general').every(template => template.compatibleAppTypes.join() === 'general')).toBe(true);
  });

  it('scaffolds the reused Chat AI Assistant sample with Claude Code docs, no generic manifest', async () => {
    const code = await run({
      name: 'chat-agent',
      appType: 'general',
      provider: 'anthropic',
      template: 'chat-ai-assistant',
      outDir: tmp,
      yes: true,
      create: true, // no creds → offline; sample still scaffolds
      claudeCode: true, // generate docs + git branch (no launch in non-interactive)
    });
    expect(code).toBe(0);

    const dir = path.join(tmp, 'chat-agent');
    expect(await exists(path.join(dir, 'src/server/app.js'))).toBe(true);
    expect(await exists(path.join(dir, '0-app-manifest/app-manifest.json'))).toBe(true);
    expect(await exists(path.join(dir, 'zoom-manifest.json'))).toBe(false); // bundled manifest is authoritative
    expect(await exists(path.join(dir, '.env'))).toBe(true);
    expect(await exists(path.join(dir, '.env.example'))).toBe(true);
    expect(await exists(path.join(dir, 'CLAUDE.md'))).toBe(true);
    expect(await exists(path.join(dir, 'DEVELOPMENT_BRIEF.md'))).toBe(true);
  });

  it('refuses to overwrite a non-empty destination', async () => {
    const dir = path.join(tmp, 'taken');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'keep.txt'), 'hi');
    await expect(
      run({ name: 'taken', appType: 'general', provider: 'anthropic', template: 'chat-ai-assistant', outDir: tmp, yes: true }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('create flow with mocked Marketplace', () => {
  it('creates the app and writes ZOOM_APP_ID into .env', async () => {
    await saveSession({version:1,environment:'prod',clientId:'public-id',accessToken:'tok',refreshToken:'r',expiresAt:Date.now()+3600000,scopes:[]});
    process.env.ZOOM_ACCOUNT_ID = 'acc';
    process.env.ZOOM_CLIENT_ID = 'cid';
    process.env.ZOOM_CLIENT_SECRET = 'csecret';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ app_id: 'APP-E2E', credentials: { client_id: 'appc', client_secret: 'apps' } }),
          { status: 201 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const code = await run({
      name: 'created-agent',
      appType: 'general',
      provider: 'anthropic',
      template: 'chat-ai-assistant',
      outDir: tmp,
      env: 'prod',
      yes: true,
      create: true,
    });
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join(" ")).toContain(
      "https://marketplace.zoom.us/develop/applications/APP-E2E/information",
    );

    const env = await fs.readFile(path.join(tmp, 'created-agent', '.env'), 'utf8');
    // chat-ai-assistant uses CLIENT_ID/CLIENT_SECRET, not APP_ID
    expect(env).toContain('ZOOM_CLIENT_ID=appc');
    expect(env).toContain('ZOOM_CLIENT_SECRET=apps'); // created app secret stored in .env only
  });
});

describe('link flow with mocked Marketplace', () => {
  it('links a scaffold-only project and diffs the linked manifest using read-only Marketplace requests', async () => {
    await saveSession({version:1,environment:'prod',clientId:'public-id',accessToken:'tok',refreshToken:'r',expiresAt:Date.now()+3600000,scopes:[]});
    process.env.ZOOM_S2S_ACCOUNT_ID = 'acc';
    process.env.ZOOM_S2S_CLIENT_ID = 'cid';
    process.env.ZOOM_S2S_CLIENT_SECRET = 'csecret';

    const appId = 'APP-EXISTING';
    const dir = path.join(tmp, 'linked-agent');
    const requests: string[] = [];
    const tokenRequest = 'POST /oauth/token';
    const manifestRequest = `GET /v2/marketplace/apps/${appId}/manifest`;
    let accessible = false;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const request = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      requests.push(request);
      if (request === tokenRequest) return Response.json({ access_token: 'tok' });
      if (request === manifestRequest) {
        if (!accessible) return Response.json({ message: 'App not found' }, { status: 404 });
        const manifest = await fs.readFile(path.join(dir, '0-app-manifest/app-manifest.json'), 'utf8');
        return Response.json({ manifest: JSON.parse(manifest) });
      }
      throw new Error(`Unexpected request: ${request}`);
    });

    expect(await run({
      name: 'linked-agent',
      appType: 'general',
      provider: 'anthropic',
      template: 'chat-ai-assistant',
      outDir: tmp,
      yes: true,
      create: false,
    })).toBe(0);
    expect(requests).toEqual([]);

    const state = await readProjectState(dir);
    expect(state.appId).toBeUndefined();
    expect(await appLink(appId, { cwd: dir })).toBe(1);
    expect(await readProjectState(dir)).toEqual(state);

    accessible = true;
    expect(await appLink(appId, { cwd: dir })).toBe(0);
    expect(await readProjectState(dir)).toMatchObject({ ...state, appId });
    expect(await appDiff({ url: 'https://dev.example.com' }, { cwd: dir })).toBe(0);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('dev.example.com');
    expect(requests).toEqual([
      manifestRequest,
      manifestRequest,
      manifestRequest,
    ]);
  });
});


describe('Marketplace creation failure reporting', () => {
  it('returns an error when Zoom rejects the manifest and preserves an unlinked project', async () => {
    await saveSession({version:1,environment:'prod',clientId:'public-id',accessToken:'tok',refreshToken:'r',expiresAt:Date.now()+3600000,scopes:[]});
    process.env.ZOOM_ACCOUNT_ID = 'acc';
    process.env.ZOOM_CLIENT_ID = 'cid';
    process.env.ZOOM_CLIENT_SECRET = 'secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 'invalid_manifest',
        message: 'Invalid manifest scope',
      }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await run({
      name: 'rejected-zcc',
      template: 'zcc-nextjs-sample',
      yes: true,
      create: true,
      outDir: tmp,
    })).toBe(1);
    const state = JSON.parse(await fs.readFile(path.join(tmp, 'rejected-zcc/.zoom-agent.json'), 'utf8'));
    expect(state.appId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('Marketplace setup needs attention');
    expect(state.marketplaceFailure?.reason).toContain('Invalid manifest scope');
    expect(logSpy.mock.calls.flat().join(' ')).toContain('zoom app create');
  });
});
