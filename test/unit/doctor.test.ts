import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDoctor } from '../../src/commands/doctor.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';

const cleanups: (() => Promise<void>)[] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  spy.mockRestore();
});

const credsOk = () => ({ ok: true as const, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] });
const credsMissing = () => ({ ok: false as const, creds: {}, missing: ['ZOOM_ACCOUNT_ID'] });
const byName = (rs: Awaited<ReturnType<typeof runDoctor>>) => Object.fromEntries(rs.map((r) => [r.name, r]));

describe('zoom doctor', () => {
  it('fails fast outside a project', async () => {
    const { dir, cleanup } = await makeProject({});
    cleanups.push(cleanup);
    // Point at an empty dir with no state above it is hard to guarantee; instead delete state.
    await (await import('node:fs/promises')).rm(`${dir}/.zoom-agent.json`);
    const rs = await runDoctor({ cwd: dir, getCreds: credsMissing });
    expect(rs[0].status).toBe('fail');
  });

  it('local checks pass and remote checks SKIP without credentials', async () => {
    const { dir, cleanup } = await makeProject({
      manifest: validManifest(),
      env: { ZOOM_CLIENT_ID: 'x', ZOOM_CLIENT_SECRET: 'y', ZOOM_ACCOUNT_ID: 'z', ZOOM_BOT_JID: 'bot@xmpp.zoom.us', ANTHROPIC_API_KEY: 'k', UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' },
    });
    cleanups.push(cleanup);
    const rs = await runDoctor({ cwd: dir, getCreds: credsMissing });
    const m = byName(rs);
    expect(m['Project configuration (.zoom-agent.json)'].status).toBe('pass');
    expect(m['Template recognized'].status).toBe('pass');
    expect(m['Manifest file present'].status).toBe('pass');
    expect(m['Manifest local validation'].status).toBe('pass');
    expect(m['Required env vars set'].status).toBe('pass');
    expect(m['Remote Marketplace validation'].status).toBe('skip');
    expect(m['ngrok tunnel connected'].status).toBe('skip');
  });

  it('fails on missing required env vars', async () => {
    const { dir, cleanup } = await makeProject({ manifest: validManifest(), env: { ZOOM_CLIENT_ID: 'x' } });
    cleanups.push(cleanup);
    const rs = await runDoctor({ cwd: dir, getCreds: credsMissing });
    expect(byName(rs)['Required env vars set'].status).toBe('fail');
  });

  it('reports both feature providers for legacy HITL projects', async () => {
    const { dir, cleanup } = await makeProject({
      state: { templateId: 'hitl-workplace-agent', provider: 'openai' },
      env: { OPENAI_API_KEY: 'test-key', ANTHROPIC_API_KEY: 'your_anthropic_api_key_here' },
    });
    cleanups.push(cleanup);
    const report = byName(await runDoctor({ cwd: dir, getCreds: credsMissing }));
    expect(report['Zoom Chat research'].status).toBe('warn');
    expect(report['Meeting intelligence and approvals'].status).toBe('pass');
    expect(report['Zoom document creation'].status).toBe('pass');
  });

  it('runs remote validation when creds + appId are present', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest() });
    const rs = await runDoctor({ cwd: dir, getCreds: credsOk, openSession: async () => session });
    const m = byName(rs);
    expect(m['Remote Marketplace validation'].status).toBe('pass');
    expect(m['Remote config matches local'].status).toBe('pass'); // proposed(no url) == remote
    expect(calls.validate).toBe(1);
    expect(calls.get).toBe(1);
  });
});
