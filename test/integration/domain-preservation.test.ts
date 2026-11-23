import { it, expect, vi, afterEach } from 'vitest';
import { appSync, appDiff } from '../../src/commands/app.js';
import { dev } from '../../src/commands/dev.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
const credentials = () => ({ ok: true, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] });

it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
  '%s diff and sync preserve every existing domain and the slash command word', async templateId => {
    const manifest = validManifest();
    manifest.manifest.features.domain_allow_list = [{ domain: 'appssdk.zoom.us', explanation: 'Required Zoom SDK' }, { domain: 'keep.example' }, { domain: 'another.example' }];
    manifest.manifest.features.development_home_uri = 'https://old.example/';
    manifest.manifest.features.team_chat_subscription.slash_command.command = 'blue';
    manifest.manifest.features.team_chat_subscription.slash_command.development_message_url = 'https://old.example/webhooks';
    const domains = structuredClone(manifest.manifest.features.domain_allow_list);
    const canonical = structuredClone(manifest); canonical.manifest.features.domain_allow_list.reverse();
    const project = await makeProject({ state: { templateId, appId: 'APP', lastDevUrl: 'https://old.example' }, manifest: canonical }); cleanups.push(project.cleanup);
    const { session, calls } = fakeSession({ initial: manifest });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = { cwd: project.dir, getCreds: credentials, openSession: async () => session };
    expect(await appDiff({ url: 'https://new.ngrok.app' }, deps)).toBe(0);
    expect(log.mock.calls.flat().join('\n')).not.toContain('domain_allow_list');
    log.mockClear();
    expect(await appSync({ url: 'https://new.ngrok.app', yes: true }, deps)).toBe(0);
    expect(calls.update).toBe(1);
    const result = await session.getManifest('APP');
    expect(result.features.domain_allow_list).toEqual(domains);
    expect(result.features.team_chat_subscription.slash_command.command).toBe('blue');
    if (templateId !== 'zcc-nextjs-sample') {
      expect(result.features.team_chat_subscription.slash_command.development_message_url).toBe('https://new.ngrok.app/webhooks');
      expect(log.mock.calls.flat().join('\n')).toContain('Chatbot webhook endpoint');
    }
    expect(log.mock.calls.flat().join('\n')).not.toContain('appssdk.zoom.us');
  },
);

it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
  '%s zoom dev previews only managed URL fields and leaves domains and command text unchanged', async templateId => {
    const manifest = validManifest();
    manifest.manifest.features.domain_allow_list = [{ domain: 'appssdk.zoom.us' }, { domain: 'existing.example' }];
    manifest.manifest.features.team_chat_subscription.slash_command.command = 'blue';
    const project = await makeProject({ state: { templateId, appId: 'APP' }, manifest }); cleanups.push(project.cleanup);
    const { session } = fakeSession({ initial: manifest });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dev({ yes: true, url: 'https://new.ngrok.app' }, {
      cwd: project.dir, getCreds: credentials, openSession: async () => session,
      startServer: async () => ({ stop: async () => {} }), waitForReady: async () => true,
      checkHealth: async () => true, waitForShutdown: async () => {},
      reconcile: async () => ({ envPath: '', changes: [], unresolved: [], wrote: false }),
    })).toBe(0);
    const result = await session.getManifest('APP');
    expect(result.features.domain_allow_list).toEqual(manifest.manifest.features.domain_allow_list);
    expect(result.features.team_chat_subscription.slash_command.command).toBe('blue');
    const output = log.mock.calls.flat().join('\n');
    expect(output).not.toContain('Development app domain');
    expect(output).not.toContain('appssdk.zoom.us');
    expect(output).not.toContain('Slash command');
  },
);
