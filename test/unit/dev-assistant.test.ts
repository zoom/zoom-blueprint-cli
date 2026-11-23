import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  generateClaudeMd,
  generateDevBrief,
  detectClaudeCode,
  initGitAndBranch,
  writeDevDocs,
} from '../../src/dev-assistant.js';
import { getTemplate } from '../../src/templates/registry.js';
import type { AgentConfig } from '../../src/types.js';

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    projectName: 'meeting-assistant',
    appType: 'general',
    provider: 'anthropic',
    templateId: 'chat-ai-assistant',
    info: {
      appName: 'Meeting Assistant',
      description: 'An AI agent for Zoom.',
      contactName: 'Dev',
      contactEmail: 'dev@example.com',
      companyName: 'Acme',
    },
    createApp: false,
    providerApiKey: 'sk-ant-SECRET-should-not-leak',
    ...overrides,
  };
}

describe('generateClaudeMd', () => {
  const template = getTemplate('chat-ai-assistant')!;
  const md = generateClaudeMd(cfg(), template);

  it('includes the required architecture sections', () => {
    for (const heading of [
      '## Project purpose',
      '## Architecture overview',
      '## Zoom integrations',
      '## Local development',
      '## Authentication requirements',
      'PRESERVE',
      '## Testing instructions',
      '## Development constraints',
    ]) {
      expect(md).toContain(heading);
    }
  });

  it('preserves the Observe → Recommend → Approve → Execute pattern note', () => {
    expect(md).toMatch(/Observe\s*→\s*Recommend\s*→\s*Approve\s*→\s*Execute/);
  });

  it('never embeds the API key', () => {
    expect(md).not.toContain('sk-ant-SECRET-should-not-leak');
  });
});

describe('generateDevBrief', () => {
  const template = getTemplate('chat-ai-assistant')!;
  it('lists selections and suggested tasks without secrets', () => {
    const brief = generateDevBrief(cfg(), template);
    expect(brief).toContain('Development Brief');
    expect(brief).toContain('Zoom Chat Research Assistant (Claude)');
    expect(brief).toContain('Suggested first customization tasks');
    expect(brief).not.toContain('sk-ant-SECRET-should-not-leak');
  });
});

describe('writeDevDocs', () => {
  it('writes CLAUDE.md and DEVELOPMENT_BRIEF.md', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devdocs-'));
    tmpDirs.push(dir);
    const written = await writeDevDocs(dir, cfg(), getTemplate('chat-ai-assistant')!);
    expect(written.map((w) => path.basename(w)).sort()).toEqual(['CLAUDE.md', 'DEVELOPMENT_BRIEF.md']);
    expect(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain('# CLAUDE.md');
  });
});

describe('detectClaudeCode', () => {
  it('returns a well-formed detection result', async () => {
    const d = await detectClaudeCode();
    expect(d.id).toBe('claude-code');
    expect(typeof d.available).toBe('boolean');
    expect(d.installHint).toMatch(/claude-code/);
  });
});

describe('initGitAndBranch', () => {
  it('initializes a repo and creates a dev branch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitinit-'));
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, 'file.txt'), 'hello');
    const res = await initGitAndBranch(dir, 'customize');
    if (!res.gitAvailable) return; // git not on PATH in this environment — skip assertions
    expect(res.initialized).toBe(true);
    expect(res.branch).toBe('customize');
    expect(
      await fs
        .access(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
  });
});
