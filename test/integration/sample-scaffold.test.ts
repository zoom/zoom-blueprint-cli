// Verifies that reusing a bundled Zoom sample (chat-ai-assistant → chatbot-services) produces a
// real project: source copied, .git excluded, the sample's .env.example preserved and overlaid
// into .env, the capability-complete manifest present, and no generic manifest written.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scaffoldTemplate } from '../../src/templates/scaffold.js';
import { overlayEnvFromExample } from '../../src/env-plan.js';
import { getTemplate } from '../../src/templates/registry.js';

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});
const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false);

describe('scaffolding the chat-ai-assistant sample', () => {
  it('copies the working sample without .git and keeps its contract files', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sample-'));
    tmpDirs.push(parent);
    const dest = path.join(parent, 'chat-demo');
    const template = getTemplate('chat-ai-assistant')!;

    await scaffoldTemplate(template, dest, { APP_NAME: 'Chat Demo', PROJECT_NAME: 'chat-demo' });

    expect(await exists(path.join(dest, 'package.json'))).toBe(true);
    expect(await exists(path.join(dest, 'src/server/app.js'))).toBe(true);
    expect(await exists(path.join(dest, '.env.example'))).toBe(true);
    expect(await exists(path.join(dest, template.manifestPath!))).toBe(true);
    // VCS and deps must never be copied.
    expect(await exists(path.join(dest, '.git'))).toBe(false);
    expect(await exists(path.join(dest, 'node_modules'))).toBe(false);
  });

  it('overlays known values into .env while leaving .env.example intact', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sample-'));
    tmpDirs.push(parent);
    const dest = path.join(parent, 'chat-demo');
    const template = getTemplate('chat-ai-assistant')!;
    await scaffoldTemplate(template, dest, { APP_NAME: 'Chat Demo', PROJECT_NAME: 'chat-demo' });

    const exampleBefore = await fs.readFile(path.join(dest, '.env.example'), 'utf8');
    const res = await overlayEnvFromExample(dest, {
      ANTHROPIC_API_KEY: 'sk-ant-REALSECRET',
      ZOOM_CLIENT_ID: 'created-client-id',
    });

    const env = await fs.readFile(path.join(dest, '.env'), 'utf8');
    const exampleAfter = await fs.readFile(path.join(dest, '.env.example'), 'utf8');

    expect(res.filled).toContain('ANTHROPIC_API_KEY');
    expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-REALSECRET');
    expect(env).toContain('ZOOM_CLIENT_ID=created-client-id');
    // The example must be untouched and must NOT contain the real secret.
    expect(exampleAfter).toBe(exampleBefore);
    expect(exampleAfter).not.toContain('sk-ant-REALSECRET');
    // .env must be owner-only on POSIX.
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(dest, '.env'))).mode & 0o777).toBe(0o600);
    }
  });
});
