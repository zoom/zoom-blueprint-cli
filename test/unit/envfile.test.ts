import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeEnvVars, readEnvValue, readEnvFile, upsertEnvLine } from '../../src/config/envfile.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-env-'));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('writeEnvVars', () => {
  it('applies multiple upserts in one write, preserving comments/order and other keys', async () => {
    const dir = await tmpDir();
    const p = path.join(dir, '.env');
    await fs.writeFile(p, '# header\nZOOM_BOT_JID=your_bot_jid_here\nPORT=4000\n');
    await writeEnvVars(p, [
      { key: 'ZOOM_BOT_JID', value: 'bot@xmpp.zoom.us' },
      { key: 'SESSION_SECRET', value: 'abcdef' },
    ]);
    const text = (await readEnvFile(p)) as string;
    expect(text).toContain('# header'); // comment preserved
    expect(text).toContain('PORT=4000'); // untouched key preserved
    expect(readEnvValue(text, 'ZOOM_BOT_JID')).toBe('bot@xmpp.zoom.us'); // updated in place
    expect(readEnvValue(text, 'SESSION_SECRET')).toBe('abcdef'); // appended
  });

  it('is a no-op for an empty entries list but reports existence', async () => {
    const dir = await tmpDir();
    const p = path.join(dir, '.env');
    const res = await writeEnvVars(p, []);
    expect(res.created).toBe(true); // file did not exist
    const exists = await fs.access(p).then(() => true).catch(() => false);
    expect(exists).toBe(false); // nothing written
  });

  it('creates the file (0600) when absent', async () => {
    const dir = await tmpDir();
    const p = path.join(dir, '.env');
    await writeEnvVars(p, [{ key: 'A', value: '1' }]);
    const stat = await fs.stat(p);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('readEnvValue', () => {
  it('reads unquoted values and ignores comments', () => {
    const text = '# ZOOM_BOT_JID=commented\nZOOM_BOT_JID="bot@xmpp.zoom.us"\nEMPTY=\n';
    expect(readEnvValue(text, 'ZOOM_BOT_JID')).toBe('bot@xmpp.zoom.us'); // skips the comment line
    expect(readEnvValue(text, 'EMPTY')).toBe('');
    expect(readEnvValue(text, 'ABSENT')).toBeUndefined();
    expect(readEnvValue(null, 'ANY')).toBeUndefined();
  });
});

describe('upsertEnvLine', () => {
  it('does not touch a commented-out key (appends a real one instead)', () => {
    const out = upsertEnvLine('# WEBVIEW_URL=old\n', 'WEBVIEW_URL', 'https://x.ngrok.app/webview');
    expect(out).toContain('# WEBVIEW_URL=old'); // comment kept
    expect(readEnvValue(out, 'WEBVIEW_URL')).toBe('https://x.ngrok.app/webview'); // real value added
  });
});
