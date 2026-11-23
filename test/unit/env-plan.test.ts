import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildEnvPlan, writeProjectEnv, unfilledKeys } from '../../src/env-plan.js';
import { getTemplate, compatibleTemplates } from '../../src/templates/registry.js';

const chat = getTemplate('chat-ai-assistant')!;
const hitl = getTemplate('hitl-workplace-agent')!;

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('buildEnvPlan', () => {
  it('wires the provider key env and default model independently of Zoom', () => {
    const entries = buildEnvPlan({ appType: 'general', provider: 'anthropic', template: chat, providerApiKey: 'sk-ant-x' });
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.AI_PROVIDER).toBeUndefined();
    expect(byKey.AI_MODEL).toBeUndefined();
    expect(byKey.ANTHROPIC_MODEL.value).toBe('claude-sonnet-4-6');
    expect(byKey.ANTHROPIC_API_KEY.value).toBe('sk-ant-x');
    expect(byKey.ANTHROPIC_API_KEY.secret).toBe(true);
  });

  it('generates both feature configurations for HITL without a global selector', () => {
    const entries = buildEnvPlan({ appType: 'general', template: hitl, providerApiKey: '' });
    expect(entries.map((entry) => entry.key)).toEqual(expect.arrayContaining([
      'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL',
    ]));
    expect(entries.filter((entry) => entry.key === 'OPENAI_API_KEY')).toHaveLength(1);
  });

  it('fills ZOOM_APP_ID/CLIENT_ID from a successful creation', () => {
    const entries = buildEnvPlan({
      appType: 'general',
      provider: 'anthropic',
      template: chat,
      providerApiKey: '',
      created: { appId: 'APP9', clientId: 'cid', clientSecret: 'sec' },
    });
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.ZOOM_APP_ID.value).toBe('APP9');
    expect(byKey.ZOOM_CLIENT_SECRET.value).toBe('sec');
    expect(unfilledKeys(entries)).toContain('ANTHROPIC_API_KEY'); // chat-ai-assistant uses Anthropic
  });

});

describe('writeProjectEnv secret hygiene', () => {
  it('writes real values to .env but only placeholders to .env.example', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'envplan-'));
    tmpDirs.push(dir);
    const entries = buildEnvPlan({
      appType: 'general',
      provider: 'anthropic',
      template: chat,
      providerApiKey: 'sk-ant-SUPERSECRET',
      created: { appId: 'APP', clientId: 'c', clientSecret: 'CLIENTSECRET' },
    });
    await writeProjectEnv(dir, entries);

    const env = await fs.readFile(path.join(dir, '.env'), 'utf8');
    const example = await fs.readFile(path.join(dir, '.env.example'), 'utf8');

    expect(env).toContain('sk-ant-SUPERSECRET');
    expect(env).toContain('CLIENTSECRET');
    // The example file must NEVER leak the real secrets.
    expect(example).not.toContain('sk-ant-SUPERSECRET');
    expect(example).not.toContain('CLIENTSECRET');
    expect(example).toContain('sk-ant-...');

    // .env must be owner-only (0600) on POSIX.
    if (process.platform !== 'win32') {
      const mode = (await fs.stat(path.join(dir, '.env'))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});
