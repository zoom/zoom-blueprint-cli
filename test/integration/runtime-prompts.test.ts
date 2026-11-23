import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { confirm } from '@inquirer/prompts';
import { dev } from '../../src/commands/dev.js';
import { startServer, waitForReady } from '../../src/commands/dev-runtime.js';
import { makeProject, validManifest, fakeSession } from '../helpers/project.js';
import type { DevServerHandle } from '../../src/commands/dev.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const f of cleanups.splice(0)) await f(); vi.restoreAllMocks(); });
async function freePort() { const s = net.createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); const port = (s.address() as net.AddressInfo).port; await new Promise<void>(r => s.close(() => r())); return port; }

it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
  '%s keeps real noisy child pipes away from an active Inquirer prompt and restarts cleanly', async templateId => {
    const project = await makeProject({ state: { templateId, appId: 'MOCK', autoSyncDevUrls: true }, manifest: validManifest() }); cleanups.push(project.cleanup);
    const fixture = path.join(project.dir, 'server.cjs');
    await fs.writeFile(fixture, `const http=require('http'); const server=http.createServer((q,r)=>{console.log('GET '+q.url+' 200');r.end('ok')}); server.listen(Number(process.env.FRONTEND_PORT||process.env.PORT)); setInterval(()=>{console.log('APP_NOISE GET /health 200');console.error('APP_DIAGNOSTIC')},5);`);
    const port = await freePort();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let terminal = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { terminal += chunk; return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => { terminal += chunk; return true; });
    for (let run = 0; run < 2; run++) {
      let handle: DevServerHandle | undefined;
      const remote = fakeSession({ initial: validManifest() }).session;
      const sync = vi.spyOn(remote, 'updateManifest');
      let answered = false;
      expect(await dev({ port, verbose: true, url: 'https://fixture.example' }, {
        cwd: project.dir,
        getCreds: () => ({ ok: true, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] }),
        startServer: async args => { handle = await startServer({ ...args, command: [process.execPath, fixture] }); return handle; },
        waitForReady: args => waitForReady({ ...args, timeoutMs: 5000, intervalMs: 10 }),
        checkHealth: async () => true,
        reconcile: async () => ({ envPath: '', changes: [], unresolved: [], wrote: false }),
        openSession: async () => remote,
        confirm: async (message, signal) => {
          const input = new PassThrough(), output = new PassThrough(); let prompt = '';
          output.on('data', c => prompt += c.toString());
          const before = terminal;
          const result = confirm({ message }, { input, output, signal });
          for (let i = 0; i < 100 && !(await fs.readFile(handle!.logFile!, 'utf8')).includes('APP_DIAGNOSTIC'); i++) await new Promise(r => setTimeout(r, 5));
          expect(terminal).toBe(before);
          expect(prompt).toContain(message);
          expect(prompt).not.toContain('APP_NOISE');
          input.write('y\n'); answered = await result;
          return answered;
        },
        waitForShutdown: async () => { expect(answered).toBe(true); },
      })).toBe(0);
      expect(sync).toHaveBeenCalledOnce();
      expect(terminal).toContain('APP_DIAGNOSTIC');
      expect(await fetch(`http://127.0.0.1:${port}`).then(() => true, () => false)).toBe(false);
    }
  }, 15000,
);

it('aborts an active prompt when a server crashes, retains diagnostics, and closes the tunnel', async () => {
  const project = await makeProject({ state: { appId: 'MOCK' }, manifest: validManifest() }); cleanups.push(project.cleanup);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  let diagnostics = ''; vi.spyOn(process.stderr, 'write').mockImplementation((c: any) => { diagnostics += c; return true; });
  let handle: DevServerHandle;
  const close = vi.fn(async () => {});
  expect(await dev({ yes: true }, {
    cwd: project.dir, hasNgrokToken: () => true,
    startTunnel: async () => ({ url: 'https://fixture.example', close }),
    startServer: async args => handle = await startServer({ ...args, command: [process.execPath, '-e', "console.error('FATAL startup failure');process.exit(7)"] }),
    waitForReady: async () => new Promise<boolean>(() => {}),
    reconcile: async () => ({ envPath: '', changes: [], unresolved: [], wrote: false }),
  })).toBe(1);
  expect(close).toHaveBeenCalledOnce(); expect(diagnostics).toContain('FATAL startup failure');
});

it('session cancellation aborts an active Inquirer prompt and cleans up the server and tunnel', async () => {
  const project = await makeProject({ state: { appId: 'MOCK' }, manifest: validManifest() }); cleanups.push(project.cleanup);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  const signals = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const close = vi.fn(async () => {});
  let handle: DevServerHandle;
  const cancel = new AbortController();
  const code = await dev({}, {
    signal: cancel.signal,
    cwd: project.dir, hasNgrokToken: () => true,
    getCreds: () => ({ ok: true, creds: { accountId: 'a', clientId: 'c', clientSecret: 's' }, missing: [] }),
    startTunnel: async () => ({ url: 'https://fixture.example', close }),
    startServer: async args => handle = await startServer({ ...args, command: [process.execPath, '-e', 'setInterval(()=>{},1000)'] }),
    waitForReady: async () => true,
    reconcile: async () => ({ envPath: '', changes: [], unresolved: [], wrote: false }),
    openSession: async () => fakeSession({ initial: validManifest() }).session,
    confirm: async (message, signal) => {
      const input = new PassThrough(), output = new PassThrough(); output.resume();
      const result = confirm({ message }, { input, output, signal });
      cancel.abort(new Error('User stopped development'));
      return result;
    },
  });
  expect(code).toBe(130); expect(close).toHaveBeenCalledOnce(); expect(handle!.signal?.aborted).toBe(true);
  expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(signals);
});

it('drains output larger than pipe capacity without deadlock and rejects unsuccessful health checks', async () => {
  const project = await makeProject({ manifest: validManifest() }); cleanups.push(project.cleanup);
  const port = await freePort();
  const fixture = path.join(project.dir, 'flood.cjs');
  await fs.writeFile(fixture, `for(let i=0;i<200;i++) process.stdout.write(Buffer.alloc(65536,'x'));require('http').createServer((q,r)=>{r.statusCode=503;r.end('unhealthy')}).listen(${port});`);
  const handle = await startServer({ cwd: project.dir, command: [process.execPath, fixture], port });
  try {
    // Let the server consume its output and reach listen before testing its 503 readiness response.
    let listening = false;
    for (let i = 0; i < 100; i++) {
      try { const res = await fetch(`http://localhost:${port}/health`); expect(res.status).toBe(503); listening = true; break; } catch {}
      await new Promise(r => setTimeout(r, 10));
    }
    expect(listening).toBe(true);
    expect(await waitForReady({ port, path: '/health', timeoutMs: 30, intervalMs: 5 })).toBe(false);
    expect((await fs.stat(handle.logFile!)).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  } finally { await handle.stop(); }
});
