import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeProject, validManifest } from '../helpers/project.js';
import { dev } from '../../src/commands/dev.js';
import { startServer } from '../../src/commands/dev-runtime.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.restoreAllMocks(); });

it('tunnels the HITL frontend while keeping the backend on its own port', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const project = await makeProject({
    state: { templateId: 'hitl-workplace-agent', env: 'prod' },
    manifest: validManifest(),
    env: { PORT: '4000', FRONTEND_PORT: '3000' },
  });
  cleanup = project.cleanup;
  const record = path.join(project.dir, 'child-env.json');
  const tunnel = vi.fn(async ({ port }) => {
    expect(port).toBe(3000);
    return { url: 'https://meeting.ngrok.app', close: async () => {} };
  });
  const code = await dev({ yes: true, noSync: true }, {
    cwd: project.dir,
    getCreds: () => ({ ok: false, creds: {}, missing: ['ZOOM_S2S_ACCOUNT_ID'] }),
    hasNgrokToken: () => true,
    startTunnel: tunnel,
    startServer: (options) => startServer({
      ...options,
      command: [process.execPath, '-e',
        'require("fs").writeFileSync(process.argv[1], JSON.stringify({ backend: process.env.PORT, frontend: process.env.FRONTEND_PORT })); setInterval(() => {}, 1000)', record],
    }),
    waitForReady: async ({ port }) => {
      expect(port).toBe(3000);
      for (let attempt = 0; attempt < 100; attempt++) {
        try { await fs.access(record); return true; } catch {}
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return false;
    },
    waitForShutdown: async () => {},
  });
  expect(code).toBe(0);
  expect(JSON.parse(await fs.readFile(record, 'utf8'))).toEqual({ backend: '4000', frontend: '3000' });
  const env = await fs.readFile(path.join(project.dir, '.env'), 'utf8');
  expect(env).toContain('PUBLIC_BASE_URL=https://meeting.ngrok.app');
  expect(env).toContain('ZOOM_REDIRECT_URI=https://meeting.ngrok.app/auth/callback');
});
