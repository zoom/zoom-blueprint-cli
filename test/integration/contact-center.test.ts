import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../src/cli.js';
import { dev } from '../../src/commands/dev.js';
import { updateProjectState, readProjectState } from '../../src/config/project-state.js';
import { fakeSession } from '../helpers/project.js';
import { buildResolvedManifest } from '../../src/manifest/project.js';
import { getTemplate } from '../../src/templates/registry.js';
import { innerManifest } from '../../src/manifest/resolve.js';

let dir: string;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

it('scaffolds Contact Center without AI and syncs its URLs while preserving domains using a mocked Marketplace', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-zcc-'));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fetch = vi.fn(() => { throw new Error('Live network forbidden'); });
  vi.stubGlobal('fetch', fetch);
  expect(await run({ name: 'contact-center', template: 'zcc-nextjs-sample', yes: true, create: false, outDir: dir })).toBe(0);
  const scaffoldOutput = output.mock.calls.flat().join('\n');
  expect(scaffoldOutput).toContain('No LLM key is required. Browser authorization uses the app Client ID and Client Secret.');
  expect(scaffoldOutput).toContain('zoom dev --no-sync');
  expect(scaffoldOutput).toContain('assign the app to your test queue');
  const project = path.join(dir, 'contact-center');
  const state = await readProjectState(project);
  expect(state.appId).toBeUndefined();
  expect(state.provider).toBeUndefined();
  const env = await fs.readFile(path.join(project, '.env'), 'utf8');
  expect(env).toContain('SITE_URL=http://localhost:3000');
  expect(env).not.toMatch(/^NGROK_AUTHTOKEN=/m);
  expect(env).not.toMatch(/OPENAI|ANTHROPIC|AI_PROVIDER/);
  expect(await fs.readFile(path.join(project, 'components/zoomapp-sdk/engagement.tsx'), 'utf8')).toContain('getEngagementContext');

  await updateProjectState(project, { appId: 'EXISTING-ZCC' });
  const manifest = JSON.parse(await fs.readFile(path.join(project, state.manifestPath!), 'utf8'));
  expect(manifest.manifest.oauth_information.scopes).toEqual([{ scope: 'zoomapp:inmeeting', optional: false }]);
  const remoteManifest = buildResolvedManifest(manifest, { baseUrl: 'https://example.ngrok.app', urlMappings: getTemplate('zcc-nextjs-sample')!.runtime!.urlMappings });
  const { session, calls } = fakeSession({ initial: remoteManifest });
  // This orchestration test stubs the server, so provide a corresponding installed-package fixture.
  const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const moduleDir = path.join(project, 'node_modules', name);
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.writeFile(path.join(moduleDir, 'package.json'), JSON.stringify({ name }));
  }
  const startServer = vi.fn(async () => ({ stop: async () => {} }));
  expect(await dev({ yes: true }, {
    cwd: project,
    getCreds: () => ({ ok: true, creds: { accountId: 'account', clientId: 'id', clientSecret: 'secret' }, missing: [] }),
    openSession: async () => session,
    hasNgrokToken: () => true,
    startTunnel: async () => ({ url: 'https://contact.ngrok.app', close: async () => {} }),
    startServer,
    waitForReady: async () => true,
    checkHealth: async () => true,
    waitForShutdown: async () => {},
  })).toBe(0);
  expect(startServer).toHaveBeenCalledWith(expect.objectContaining({
    port: 3000, env: expect.objectContaining({ SITE_URL: 'https://contact.ngrok.app' }),
  }));
  const remote = innerManifest(await session.getManifest('EXISTING-ZCC'));
  expect(remote.features.development_home_uri).toBe('https://contact.ngrok.app/');
  expect(remote.features.domain_allow_list[1].domain).toBe('example.ngrok.app');
  expect(remote.features.domain_allow_list[0].domain).toBe('appssdk.zoom.us');
  const devOutput = output.mock.calls.flat().join('\n');
  expect(devOutput).toContain('https://marketplace.zoom.us/develop/applications/EXISTING-ZCC/information');
  expect(devOutput).toContain('Authorize and open in Zoom');
  expect(devOutput).toContain('Open in Zoom');
  expect(devOutput).toContain('handle an engagement from that queue');
  expect(devOutput).not.toContain('send the bot a Zoom Chat message');
  expect(calls.update).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});
