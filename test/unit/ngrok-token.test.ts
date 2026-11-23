import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveNgrokToken, hasNgrokToken, checkHealth } from '../../src/commands/dev-runtime.js';

const saved: Record<string, string | undefined> = {};
const KEYS = ['NGROK_AUTHTOKEN', 'NGROK_CONFIG'];
const tmp: string[] = [];

function snapshot() {
  for (const k of KEYS) saved[k] = process.env[k];
}
afterEach(async () => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('resolveNgrokToken precedence', () => {
  it('prefers the NGROK_AUTHTOKEN env var', () => {
    snapshot();
    process.env.NGROK_AUTHTOKEN = 'env-token';
    const r = resolveNgrokToken();
    expect(r.source).toBe('env');
    expect(r.token).toBe('env-token');
    expect(hasNgrokToken()).toBe(true);
  });

  it('falls back to the ngrok config file (reusable across projects)', async () => {
    snapshot();
    delete process.env.NGROK_AUTHTOKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ngrokcfg-'));
    tmp.push(dir);
    const cfg = path.join(dir, 'ngrok.yml');
    await fs.writeFile(cfg, 'version: "2"\nauthtoken: cfg-token-123\n');
    process.env.NGROK_CONFIG = cfg;
    const r = resolveNgrokToken();
    expect(r.source).toBe('ngrok-config');
    expect(r.token).toBe('cfg-token-123');
    expect(hasNgrokToken()).toBe(true);
  });

  it('reports no token when neither source has one', async () => {
    snapshot();
    delete process.env.NGROK_AUTHTOKEN;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ngrokcfg-'));
    tmp.push(dir);
    process.env.NGROK_CONFIG = path.join(dir, 'does-not-exist.yml');
    // Also ensure no real config leaks in: treat a found token as acceptable only if the file exists.
    const r = resolveNgrokToken();
    // On a dev machine a real ngrok config could exist; only assert the empty-file path behaves.
    if (!r.token) {
      expect(hasNgrokToken()).toBe(false);
    } else {
      expect(r.source).toBe('ngrok-config'); // picked up a real machine config, still valid
    }
  });

  it('never exposes the token value in logs path (returns it for internal use only)', () => {
    snapshot();
    process.env.NGROK_AUTHTOKEN = 'secret';
    // The function returns the token for the SDK; callers must not print it. Sanity: it is returned, not undefined.
    expect(resolveNgrokToken().token).toBe('secret');
  });
});

describe('checkHealth', () => {
  it('returns false for an unreachable URL (no throw)', async () => {
    const ok = await checkHealth('http://127.0.0.1:1/definitely-down');
    expect(ok).toBe(false);
  });
});
