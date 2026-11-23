import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { startServer, waitForReady } from '../../src/commands/dev-runtime.js';

it('does not launch the HITL frontend until the backend health endpoint succeeds', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hitl-ordered-'));
  let healthy = false;
  let probed!: () => void;
  const firstProbe = new Promise<void>(resolve => { probed = resolve; });
  const backend = http.createServer((_req, res) => { res.statusCode = healthy ? 200 : 503; res.end('health'); probed(); });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const backendPort = (backend.address() as net.AddressInfo).port;
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const frontendPort = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await fs.mkdir(path.join(dir, 'scripts')); await fs.mkdir(path.join(dir, 'frontend'));
  for (const file of ['lib.mjs', 'backend-readiness.mjs', 'start-frontend.mjs']) {
    await fs.copyFile(path.resolve('templates/hitl-workplace-agent/scripts', file), path.join(dir, 'scripts', file));
  }
  await fs.writeFile(path.join(dir, 'frontend/package.json'), JSON.stringify({ scripts: { dev: 'node server.cjs' } }));
  await fs.writeFile(path.join(dir, 'frontend/server.cjs'), "require('fs').writeFileSync('../frontend-started', 'yes');require('http').createServer((q,r)=>r.end('ok')).listen(Number(process.argv[process.argv.indexOf('--port')+1]));");
  const child = await startServer({ cwd: dir, command: [process.execPath, 'scripts/start-frontend.mjs'], port: frontendPort,
    env: { EXPRESS_ORIGIN: `http://127.0.0.1:${backendPort}`, FRONTEND_PORT: String(frontendPort) } });
  try {
    await firstProbe;
    await expect(fs.access(path.join(dir, 'frontend-started'))).rejects.toThrow();
    expect(await fetch(`http://127.0.0.1:${frontendPort}`).then(() => true, () => false)).toBe(false);
    healthy = true;
    expect(await waitForReady({ port: frontendPort, timeoutMs: 5000, intervalMs: 20 })).toBe(true);
    expect(await fs.readFile(path.join(dir, 'frontend-started'), 'utf8')).toBe('yes');
  } finally {
    await child.stop(); backend.closeAllConnections();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
}, 10000);
