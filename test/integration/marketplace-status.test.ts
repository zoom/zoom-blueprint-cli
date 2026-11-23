import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dev } from '../../src/commands/dev.js';
import { readProjectState } from '../../src/config/project-state.js';
import { marketplaceFailure, readMarketplaceFailure } from '../../src/util/marketplace-status.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); vi.restoreAllMocks(); });

it('redacts persisted Marketplace errors and preserves the rejected field', () => {
  const failure = marketplaceFailure('create', { message: 'client_secret=private', body: { errors: [{ setting: '/features/team_chat_subscription/slash_command/command', message: "The command 'zwc' is in use" }] } });
  expect(JSON.stringify(failure)).not.toContain('private');
  expect(failure.issues[0].setting).toContain('slash_command/command');
});

it('recovers the failed create reason from a legacy parent recovery record', async () => {
  const project = await makeProject({ manifest: validManifest() }); cleanups.push(project.cleanup);
  const nested = path.join(project.dir, 'apps', 'chat-agent'); await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(path.join(project.dir, '.zoom-agent-state'));
  await fs.writeFile(path.join(project.dir, '.zoom-agent-state', 'app-chat-agent.json'), JSON.stringify({ status: 'failed', error: "The command 'zwc' is in use" }));
  const state = await readProjectState(project.dir);
  expect((await readMarketplaceFailure(nested, state))?.reason).toContain('zwc');
});

it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
  '%s preserves a rejected sync, shows it on the next dev run, and clears it after verification', async templateId => {
    const project = await makeProject({ state: { templateId, appId: 'LINKED', autoSyncDevUrls: true }, manifest: validManifest() }); cleanups.push(project.cleanup);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const remote = fakeSession({ initial: validManifest() }).session;
    const invalid = { ok: false, status: 400, issues: [{ setting: '/oauth_information/development_redirect_uri', message: 'Redirect URL rejected' }], raw: {} };
    const update = vi.spyOn(remote, 'updateManifest');
    const validate = vi.spyOn(remote, 'validate').mockResolvedValue(invalid);
    const deps = {
      cwd: project.dir,
      getCreds: () => ({ ok: true, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] }),
      hasNgrokToken: () => true,
      startTunnel: async () => ({ url: 'https://new.ngrok.app', close: async () => {} }),
      startServer: async () => ({ stop: async () => {} }),
      waitForReady: async () => true,
      checkHealth: async () => true,
      openSession: async () => remote,
      reconcile: async () => ({ envPath: '/tmp/.env', changes: [], unresolved: [], wrote: false }),
      waitForShutdown: async () => {},
    };
    await dev({ yes: true }, deps);
    expect((await readProjectState(project.dir)).marketplaceFailure?.issues[0].message).toBe('Redirect URL rejected');
    expect(update).not.toHaveBeenCalled();
    log.mockClear();
    validate.mockResolvedValue({ ok: true, status: 200, issues: [], raw: {} });
    await dev({ yes: true }, deps);
    const output = log.mock.calls.flat().join('\n');
    expect(output.indexOf('Redirect URL rejected')).toBeGreaterThan(-1);
    expect(output.indexOf('Redirect URL rejected')).toBeLessThan(output.indexOf('Development server started'));
    expect((await readProjectState(project.dir)).marketplaceFailure).toBeUndefined();
  },
);
