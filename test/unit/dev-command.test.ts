import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dev, type DevDeps } from '../../src/commands/dev.js';
import { readProjectState } from '../../src/config/project-state.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';

const cleanups: (() => Promise<void>)[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  spies.forEach((s) => s.mockRestore());
});

const credsOk = () => ({ ok: true as const, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] });
const credsMissing = () => ({ ok: false as const, creds: {}, missing: ['ZOOM_ACCOUNT_ID'] });

function baseDeps(over: Partial<DevDeps> = {}): {
  deps: DevDeps;
  stop: any;
  close: any;
  startServer: any;
  startTunnel: any;
  checkHealth: any;
  reconcile: any;
} {
  const stop = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const startServer = vi.fn(async () => ({ stop }));
  const startTunnel = vi.fn(async () => ({ url: 'https://abc.ngrok.app', close }));
  const checkHealth = vi.fn(async () => true);
  // Stub reconcile so the orchestration tests never hit real prompts / Marketplace lookups.
  const reconcile = vi.fn(async () => ({ envPath: '/tmp/.env', changes: [], unresolved: [], wrote: false }));
  const deps: DevDeps = {
    getCreds: credsOk,
    hasNgrokToken: () => true,
    startServer,
    waitForReady: async () => true,
    startTunnel,
    checkHealth,
    openSession: async () => fakeSession({ initial: validManifest() }).session,
    reconcile,
    confirm: async () => true,
    waitForShutdown: async () => {},
    ...over,
  };
  return { deps, stop, close, startServer, startTunnel, checkHealth, reconcile };
}

describe('zoom dev — server template (chat-ai-assistant)', () => {
  it('starts server → tunnel → syncs → records lastDevUrl → cleans up', async () => {
    const { dir, cleanup } = await makeProject({
      state: { appId: 'APP1', manifestPath: '0-app-manifest/app-manifest.json' },
    });
    cleanups.push(cleanup);
    const { deps, stop, close, startTunnel, checkHealth } = baseDeps();
    const code = await dev({}, { ...deps, cwd: dir });
    expect(code).toBe(0);
    expect(startTunnel).toHaveBeenCalled();
    expect(checkHealth).toHaveBeenCalledWith('https://abc.ngrok.app/health'); // public health via tunnel
    expect(close).toHaveBeenCalled(); // cleanup
    expect(stop).toHaveBeenCalled();
    const state = await readProjectState(dir);
    expect(state.lastDevUrl).toBe('https://abc.ngrok.app');
    expect(state.syncedDevUrl).toBe('https://abc.ngrok.app'); // recorded on successful sync
  });

  it('refuses to start when dependencies are not installed (clear message, no server spawn)', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' } });
    cleanups.push(cleanup);
    // A package.json that declares deps, but no node_modules.
    await (await import('node:fs/promises')).writeFile(
      `${dir}/package.json`,
      JSON.stringify({ name: 'x', dependencies: { express: '^5' } }),
    );
    const { deps, startServer, startTunnel } = baseDeps();
    const code = await dev({}, { ...deps, cwd: dir });
    expect(code).toBe(1);
    expect(startServer).not.toHaveBeenCalled();
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it('does NOT claim a tunnel when NGROK_AUTHTOKEN is missing; nothing was started', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' } });
    cleanups.push(cleanup);
    // ngrok is now checked FIRST (fail-fast), before the server starts — so nothing needs stopping.
    const { deps, stop, startTunnel, startServer } = baseDeps({ hasNgrokToken: () => false });
    const code = await dev({}, { ...deps, cwd: dir });
    expect(code).toBe(1);
    expect(startTunnel).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('fails cleanly if the dev server never becomes ready (tunnel already up → closed)', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' } });
    cleanups.push(cleanup);
    // Tunnel now starts before the server, so it IS opened and must be closed on failure.
    const { deps, stop, close, startTunnel } = baseDeps({ waitForReady: async () => false });
    const code = await dev({}, { ...deps, cwd: dir });
    expect(code).toBe(1);
    expect(startTunnel).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('skips sync (but keeps the tunnel) when credentials are missing', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' } });
    cleanups.push(cleanup);
    const openSession = vi.fn();
    const { deps, close } = baseDeps({ getCreds: credsMissing, openSession });
    const code = await dev({}, { ...deps, cwd: dir });
    expect(code).toBe(0);
    expect(openSession).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('skips sync with --no-sync', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' } });
    cleanups.push(cleanup);
    const openSession = vi.fn();
    const { deps } = baseDeps({ openSession });
    const code = await dev({ noSync: true }, { ...deps, cwd: dir });
    expect(code).toBe(0);
    expect(openSession).not.toHaveBeenCalled();
  });
});

describe('zoom dev — template coverage in v0.2.0', () => {
  it('only supports General App templates with server runtime in v0.2.0 release', async () => {
    const {compatibleTemplates} = await import('../../src/templates/registry.js');


    const general = compatibleTemplates('general');
    expect(general.length).toBeGreaterThan(0);
    expect(general.every(t => t.runtime?.kind === 'server')).toBe(true);
  });
});

it('requires explicit review before a prior auto-sync grant overwrites a custom Marketplace endpoint', async () => {
  const manifest = validManifest();
  manifest.manifest.features.event_subscription.events[0].development_webhook_url = 'https://custom-backend.example/webhooks';
  const project = await makeProject({ state: { appId: 'APP', autoSyncDevUrls: true, lastDevUrl: 'https://old.ngrok.app' }, manifest });
  cleanups.push(project.cleanup);
  const remote = fakeSession({ initial: manifest });
  const chooseSync = vi.fn(async () => false);
  const { deps } = baseDeps({ openSession: async () => remote.session, chooseSync });
  expect(await dev({}, { ...deps, cwd: project.dir })).toBe(0);
  expect(chooseSync).toHaveBeenCalledOnce();
  expect(remote.calls.update).toBe(0);
  expect((await remote.session.getManifest('APP')).features.event_subscription.events[0].development_webhook_url).toBe('https://custom-backend.example/webhooks');
});


describe('first-run sync and remote readback', () => {
  it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
    '%s verifies mixed manifests and detects an accepted update that did not persist', async (templateId) => {
      const { getTemplate } = await import('../../src/templates/registry.js');
      const { getPath, innerManifest } = await import('../../src/manifest/resolve.js');
      for (const persists of [true, false]) {
        const manifest = validManifest();
        manifest.manifest.oauth_information.development_redirect_uri = '{{DEV_BASE_URL}}/auth/callback';
        manifest.manifest.features.development_home_uri = 'https://example.ngrok.app/';
        const project = await makeProject({ manifest, state: { appId: 'APP', templateId } });
        cleanups.push(project.cleanup);
        const remote = fakeSession({ initial: manifest });
        let submitted: any;
        const update = remote.session.updateManifest;
        remote.session.updateManifest = async (id, proposed) => {
          submitted = proposed;
          return persists ? update(id, proposed) : { status: 204 };
        };
        spies[0].mockClear();
        const { deps } = baseDeps({ openSession: async () => remote.session });
        await dev({ yes: true }, { ...deps, cwd: project.dir });
        expect((await readProjectState(project.dir)).syncedDevUrl).toBe(persists ? 'https://abc.ngrok.app' : undefined);
        const output = spies[0].mock.calls.flat().join('\n');
        expect(remote.calls.get).toBeGreaterThanOrEqual(2);
        for (const mapping of getTemplate(templateId)!.runtime!.urlMappings!) {
          expect(getPath(innerManifest(submitted), mapping.path)).toBe(`https://abc.ngrok.app${mapping.route || ''}`);
        }
        if (persists) expect(output).toContain('verified');
        else {
          expect(output).toContain('could not be verified');
          expect(output).toContain('Expected:');
          expect(output).toContain('Received:');
          expect(output).not.toContain('OAuth callback verified');
        }
      }
    },
  );
});
