import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../../src/cli.js';

let dir: string;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('template-specific inference', () => {
  it('executes generated applications with fixed feature routing and no Marketplace traffic', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-provider-routing-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetch = vi.fn(() => { throw new Error('Marketplace traffic forbidden'); });
    vi.stubGlobal('fetch', fetch);
    for (const [name, template] of [['chat', 'chat-ai-assistant'], ['hitl', 'hitl-workplace-agent']]) {
      expect(await run({ name, template, outDir: dir, yes: true, create: false })).toBe(0);
      expect(await fs.readFile(path.join(dir, name, '.env'), 'utf8')).not.toMatch(/^NGROK_AUTHTOKEN=/m);
    }
    expect(fetch).not.toHaveBeenCalled();
    const state = JSON.parse(await fs.readFile(path.join(dir, 'hitl/.zoom-agent.json'), 'utf8'));
    expect(state.provider).toBeUndefined();
    const output = execFileSync(process.execPath, [
      '--experimental-vm-modules', 'test/helpers/provider-runtime.mjs', dir,
    ], { encoding: 'utf8' });
    expect(output).toContain('Verified feature routing');
  });

  it('rejects unsupported provider flags before writing a project', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-provider-rejection-'));
    for (const [template, provider] of [
      ['chat-ai-assistant', 'openai'],
      ['hitl-workplace-agent', 'anthropic'],
      ['hitl-workplace-agent', 'openai'],
    ] as const) {
      await expect(run({ name: 'invalid', template, provider, outDir: dir, yes: true, create: false }))
        .rejects.toThrow('does not support --provider');
      expect(await fs.readdir(dir)).toEqual([]);
    }
  });
});
