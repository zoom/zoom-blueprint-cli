import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadDotenv } from '../../src/config/dotenv.js';

const tmpDirs: string[] = [];
const touched: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
  for (const k of touched.splice(0)) delete process.env[k];
});

async function writeEnv(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotenv-'));
  tmpDirs.push(dir);
  const file = path.join(dir, '.env');
  await fs.writeFile(file, contents, 'utf8');
  return file;
}

describe('loadDotenv', () => {
  it('loads KEY=VALUE pairs, handling quotes, export, and comments', async () => {
    const file = await writeEnv(
      ['# a comment', 'export ZOOM_ACCOUNT_ID=acc123', 'ZOOM_CLIENT_ID="cid with space"', "FOO='bar'", 'blank', ''].join('\n'),
    );
    touched.push('ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'FOO');
    const res = loadDotenv(file);
    expect(res.loaded).toBe(true);
    expect(res.keys).toEqual(['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'FOO']);
    expect(process.env.ZOOM_ACCOUNT_ID).toBe('acc123');
    expect(process.env.ZOOM_CLIENT_ID).toBe('cid with space');
    expect(process.env.FOO).toBe('bar');
  });

  it('does not overwrite an existing real environment variable', async () => {
    process.env.ZOOM_CLIENT_SECRET = 'from-shell';
    touched.push('ZOOM_CLIENT_SECRET');
    const file = await writeEnv('ZOOM_CLIENT_SECRET=from-file');
    loadDotenv(file);
    expect(process.env.ZOOM_CLIENT_SECRET).toBe('from-shell');
  });

  it('skips an empty value and lets a later non-empty line for the same key win (no shadowing)', async () => {
    const file = await writeEnv(['NGROK_AUTHTOKEN=', 'OTHER=x', 'NGROK_AUTHTOKEN=real-token'].join('\n'));
    touched.push('NGROK_AUTHTOKEN', 'OTHER');
    loadDotenv(file);
    // The empty first line is skipped, so the real value below wins instead of being shadowed.
    expect(process.env.NGROK_AUTHTOKEN).toBe('real-token');
  });

  it('treats a lone empty value as not set', async () => {
    const file = await writeEnv('EMPTYKEY=');
    const res = loadDotenv(file);
    expect(res.keys).not.toContain('EMPTYKEY');
    expect(process.env.EMPTYKEY).toBeUndefined();
  });

  it('returns loaded:false when the file is missing (no throw)', () => {
    const res = loadDotenv(path.join(os.tmpdir(), 'definitely-missing-xyz', '.env'));
    expect(res.loaded).toBe(false);
    expect(res.keys).toEqual([]);
  });
});
