// Real implementations for `zoom dev`'s injectable dependencies: spawn the dev server, poll for
// readiness, open an ngrok tunnel (lazy import so the native dep is optional), and block until the
// developer presses Ctrl+C. Kept separate from dev.ts so the orchestration stays testable.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseSync } from './sync-prompt.js';
import { DevOutput } from './dev-output.js';
import { confirm as inquirerConfirm } from '@inquirer/prompts';
import type { DevDeps, DevServerHandle, DevTunnel } from './dev.js';

/** Candidate paths for the ngrok agent config file, across platforms. */
function ngrokConfigPaths(): string[] {
  const home = os.homedir();
  const custom = process.env.NGROK_CONFIG;
  return [
    ...(custom ? [custom] : []),
    path.join(home, 'Library', 'Application Support', 'ngrok', 'ngrok.yml'), // macOS
    path.join(home, '.config', 'ngrok', 'ngrok.yml'), // Linux / XDG
    path.join(home, 'AppData', 'Local', 'ngrok', 'ngrok.yml'), // Windows
    path.join(home, '.ngrok2', 'ngrok.yml'), // legacy
  ];
}

/** Read an `authtoken:` from the ngrok agent config, if one is configured. Never logged. */
function tokenFromNgrokConfig(): string | undefined {
  for (const p of ngrokConfigPaths()) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^\s*authtoken:\s*["']?([^"'\s#]+)/m);
      if (m) return m[1];
    } catch {
      /* file absent / unreadable — try next */
    }
  }
  return undefined;
}

/**
 * Resolve the ngrok authtoken with a documented precedence:
 *   1. `NGROK_AUTHTOKEN` in the environment (shell export, --env-file, or the project's .env), then
 *   2. the ngrok agent config file (`ngrok config add-authtoken`) — reusable across projects.
 * Returns the (secret) token plus its source. The caller must NEVER print the token.
 */
export function resolveNgrokToken(): { token?: string; source?: 'env' | 'ngrok-config' } {
  const env = process.env.NGROK_AUTHTOKEN;
  if (env && env.trim() !== '') return { token: env.trim(), source: 'env' };
  const cfg = tokenFromNgrokConfig();
  if (cfg) return { token: cfg, source: 'ngrok-config' };
  return {};
}

export function hasNgrokToken(): boolean {
  return !!resolveNgrokToken().token;
}

/** Pipe application output so the CLI exclusively owns stdin and the terminal during setup. */
export async function startServer({ cwd, command, port, portEnv = 'PORT', env, verbose }: {
  cwd: string; command: string[]; port: number; portEnv?: string;
  env?: Record<string, string>; verbose?: boolean;
}): Promise<DevServerHandle> {
  const output = new DevOutput(verbose);
  const [cmd, ...args] = command;
  const childEnv = { ...process.env, ...env, [portEnv]: String(port) };
  // Template runtimes use their own app credentials; management and tunnel credentials stay in the CLI.
  for (const key of ['NGROK_AUTHTOKEN', 'ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET']) delete childEnv[key];
  if (verbose) childEnv.ZOOM_CLI_VERBOSE = '1';
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv, detached: process.platform !== 'win32' });
  const controller = new AbortController();
  let stopping = false;
  let ended = false;
  let closed = false;
  const closedPromise = new Promise<void>(resolve => child.once('close', () => { closed = true; resolve(); }));
  let failure: Error | undefined;
  for (const stream of ['stdout', 'stderr'] as const) {
    child[stream]!.on('data', (data: Buffer) => {
      const sink = output.write(stream, data);
      if (sink) { child[stream]!.pause(); sink.once('drain', () => child[stream]!.resume()); }
    });
  }
  const exited = new Promise<Error>(resolve => {
    const finish = (error: Error) => {
      if (ended) return;
      ended = true;
      failure = stopping ? undefined : error;
      controller.abort(error);
      resolve(error);
    };
    child.once('error', error => finish(new Error(`Cannot start ${cmd}: ${error.message}`)));
    child.once('exit', (code, signal) => finish(new Error(`Development server exited (${signal ? 'signal ' + signal : 'code ' + code}). Runtime log: ${output.file}`)));
  });
  const signalTree = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
      else process.kill(-child.pid, signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  return {
    logFile: output.file, signal: controller.signal, exited,
    releaseOutput: () => output.release(),
    stop: async () => {
      if (stopping) return;
      stopping = true;
      // Kill the group even when npm exited first: grandchildren may still own the port.
      signalTree('SIGINT');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = (ms: number) => new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
      if (!closed) await Promise.race([closedPromise, wait(1500)]);
      if (timer) clearTimeout(timer);
      signalTree('SIGTERM');
      if (!closed) await Promise.race([closedPromise, wait(1000)]);
      if (timer) clearTimeout(timer);
      signalTree('SIGKILL');
      if (!closed) await Promise.race([closedPromise, wait(1000)]);
      if (timer) clearTimeout(timer);
      output.close(!!failure && !controller.signal.reason?.message?.includes('SIGINT') && !controller.signal.reason?.message?.includes('SIGTERM'));
    },
  };
}

/** Poll the local readiness endpoint until it returns a successful HTTP response. */
export async function waitForReady({
  port,
  path = '/',
  timeoutMs = 30000,
  intervalMs = 500,
  signal,
}: {
  port: number;
  path?: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const url = `http://localhost:${port}${path.startsWith('/') ? path : `/${path}`}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return false;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000);
      let response: Response;
      try { response = await fetch(url, { signal: ac.signal }); } finally { clearTimeout(t); }
      if (response.ok) return true;
      if (Date.now() > deadline) return false;
      await new Promise(r => setTimeout(r, intervalMs));
    } catch {
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Open an ngrok tunnel to the local port. Lazily imports @ngrok/ngrok (optional dependency). */
export async function startTunnel({ port }: { port: number }): Promise<DevTunnel> {
  let ngrok: any;
  try {
    // Computed specifier so TypeScript doesn't statically resolve this optional dependency.
    const pkg = '@ngrok/ngrok';
    ngrok = await import(pkg);
  } catch {
    throw new Error(
      'The ngrok SDK is not installed. Run `npm install @ngrok/ngrok` in the CLI, or install it globally.',
    );
  }
  const fwd = ngrok.forward ?? ngrok.default?.forward;
  // Pass the resolved token explicitly (env or ngrok config) so the config-file path is honored.
  const { token } = resolveNgrokToken();
  const cfg: Record<string, unknown> = { addr: port };
  if (token) cfg.authtoken = token;
  else cfg.authtoken_from_env = true; // fall back to the SDK's own env lookup
  const listener = await fwd(cfg);
  const url: string | null = listener.url();
  if (!url) throw new Error('ngrok did not return a public URL.');
  return {
    url,
    close: async () => {
      try {
        await listener.close();
      } catch {
        /* best-effort */
      }
    },
  };
}

/** GET a public URL once; true on a 2xx response. Used to confirm the tunnel reaches the server. */
export async function checkHealth(url: string): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try { return (await fetch(url, { signal: ac.signal })).ok; } finally { clearTimeout(t); }
  } catch {
    return false;
  }
}

/** Block until SIGINT/SIGTERM (Ctrl+C). Resolves so the caller can clean up. */
export function waitForShutdown(signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const done = () => {
      signal?.removeEventListener('abort', done);
      process.removeListener('SIGINT', done);
      process.removeListener('SIGTERM', done);
      resolve();
    };
    signal?.addEventListener('abort', done, { once: true });
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

/** The real-dependency bundle for `zoom dev`. */
export const realDevDeps: DevDeps = {
  hasNgrokToken,
  chooseSync,
  startServer,
  waitForReady,
  startTunnel,
  checkHealth,
  waitForShutdown,
  confirm: async (message: string, signal?: AbortSignal) => {
    if (!process.stdin.isTTY) { console.log('  Sync skipped in noninteractive mode. Use --yes to approve sync.'); return false; }
    console.log();
    try { return await inquirerConfirm({ message, default: true }, { signal }); } finally { console.log(); }
  },
};
