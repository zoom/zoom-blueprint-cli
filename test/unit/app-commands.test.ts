import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appValidate, appDiff, appSync } from '../../src/commands/app.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';

const cleanups: (() => Promise<void>)[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

const credsOk = () => ({ ok: true as const, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] });
const credsMissing = () => ({ ok: false as const, creds: {}, missing: ['ZOOM_ACCOUNT_ID'] });

describe('zoom app validate', () => {
  it('passes local-only and SKIPS remote when credentials are missing', async () => {
    const { dir, cleanup } = await makeProject({ manifest: validManifest() });
    cleanups.push(cleanup);
    const openSession = vi.fn();
    const code = await appValidate({}, { cwd: dir, getCreds: credsMissing, openSession });
    expect(code).toBe(0);
    expect(openSession).not.toHaveBeenCalled(); // no remote call without creds
  });

  it('fails locally on a structurally invalid manifest (and never calls remote)', async () => {
    const bad = { manifest: { oauth_information: {}, features: {} } }; // no display_information
    const { dir, cleanup } = await makeProject({ manifest: bad });
    cleanups.push(cleanup);
    const openSession = vi.fn();
    const code = await appValidate({}, { cwd: dir, getCreds: credsOk, openSession });
    expect(code).toBe(1);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('calls remote validation and fails on field-level issues', async () => {
    const { dir, cleanup } = await makeProject({ manifest: validManifest() });
    cleanups.push(cleanup);
    const { session } = fakeSession({ initial: validManifest(), validate: () => ({ ok: false, issues: [{ setting: 'display_name', message: 'bad' }] }) });
    const code = await appValidate({}, { cwd: dir, getCreds: credsOk, openSession: async () => session });
    expect(code).toBe(1);
  });

  it('passes when remote validation is clean', async () => {
    const { dir, cleanup } = await makeProject({ manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest() });
    const code = await appValidate({}, { cwd: dir, getCreds: credsOk, openSession: async () => session });
    expect(code).toBe(0);
    expect(calls.validate).toBe(1);
  });
});

describe('zoom app diff', () => {
  it('errors when the project is not linked to an app', async () => {
    const { dir, cleanup } = await makeProject({ manifest: validManifest() /* no appId */ });
    cleanups.push(cleanup);
    const code = await appDiff({}, { cwd: dir, getCreds: credsOk, openSession: vi.fn() });
    expect(code).toBe(1);
  });

  it('fetches remote and reports a diff', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest('Remote Name') });
    const code = await appDiff({ url: 'https://new.ngrok.app' }, { cwd: dir, getCreds: credsOk, openSession: async () => session });
    expect(code).toBe(0);
    expect(calls.get).toBe(1);
  });
});

describe('zoom app sync', () => {
  it('reports unsupported for Server-to-Server apps (no manifest forced)', async () => {
    const { dir, cleanup } = await makeProject({ state: { appType: 's2s' as any, templateId: 's2s-meeting-agent', manifestPath: undefined } });
    cleanups.push(cleanup);
    const openSession = vi.fn();
    await expect(appSync({}, { cwd: dir, getCreds: credsOk, openSession })).rejects.toThrow(/General Apps only/);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('no-ops when already in sync', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest() });
    // No url → no URL changes → proposed equals remote → nothing to apply.
    const code = await appSync({}, { cwd: dir, getCreds: credsOk, openSession: async () => session });
    expect(code).toBe(0);
    expect(calls.update).toBe(0);
  });

  it('applies changes after confirmation, then verifies the result', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest() });
    const confirm = vi.fn(async () => true);
    const code = await appSync(
      { url: 'https://new.ngrok.app' },
      { cwd: dir, getCreds: credsOk, openSession: async () => session, confirm },
    );
    expect(confirm).toHaveBeenCalled();
    expect(calls.update).toBe(1);
    expect(calls.get).toBe(2); // fetch-before + verify-after
    expect(code).toBe(0);
  });

  it('does NOT apply when the user declines', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest() });
    const code = await appSync(
      { url: 'https://new.ngrok.app' },
      { cwd: dir, getCreds: credsOk, openSession: async () => session, confirm: async () => false },
    );
    expect(calls.update).toBe(0);
    expect(code).toBe(0);
  });

  it('aborts (no update) when the proposed manifest fails validation', async () => {
    const { dir, cleanup } = await makeProject({ state: { appId: 'APP1' }, manifest: validManifest() });
    cleanups.push(cleanup);
    const { session, calls } = fakeSession({ initial: validManifest(), validate: () => ({ ok: false, issues: [{ message: 'nope' }] }) });
    const code = await appSync(
      { url: 'https://new.ngrok.app', yes: true },
      { cwd: dir, getCreds: credsOk, openSession: async () => session },
    );
    expect(calls.update).toBe(0);
    expect(code).toBe(1);
  });
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
        logSpy.mockClear();
        const code = await appSync({ yes: true, url: 'https://abc.ngrok.app' }, {
          cwd: project.dir, getCreds: credsOk, openSession: async () => remote.session,
        });
        expect(code).toBe(persists ? 0 : 1);
        const output = logSpy.mock.calls.flat().join('\n');
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
