import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(), input: vi.fn(), confirm: vi.fn(), password: vi.fn(),
}));
import { select, input, confirm, password } from '@inquirer/prompts';
import { run } from '../../src/cli.js';
let dir: string;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

it('chooses the template first and saves both feature keys without asking for a global provider', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-provider-prompts-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
  vi.mocked(select).mockImplementationOnce(async (question: any) => {
    expect(question.message).toBe('Choose a starter template');
    return 'hitl-workplace-agent';
  });
  vi.mocked(input).mockResolvedValue('Audit');
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(password).mockResolvedValueOnce('sk-ant-test').mockResolvedValueOnce('openai-test');
  expect(await run({ name: 'interactive', appType: 'general', outDir: dir, create: false, claudeCode: false })).toBe(0);
  expect(select).toHaveBeenCalledTimes(1);
  const env = await fs.readFile(path.join(dir, 'interactive/.env'), 'utf8');
  expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-test');
  expect(env).toContain('OPENAI_API_KEY=openai-test');
  expect(env).not.toMatch(/^AI_PROVIDER=/m);
  expect(env).not.toMatch(/^AI_MODEL=/m);
  expect(fetch).not.toHaveBeenCalled();
});
