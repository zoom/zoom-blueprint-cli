import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  writeProjectState,
  readProjectState,
  findProjectRoot,
  loadProjectState,
  updateProjectState,
  STATE_FILE,
  type ProjectState,
} from '../../src/config/project-state.js';

const tmpDirs: string[] = [];
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

function sample(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    version: 1,
    projectName: 'chat-agent',
    templateId: 'chat-ai-assistant',
    appType: 'general',
    provider: 'anthropic',
    env: 'prod',
    marketplaceSetup: 'auto',
    manifestPath: '0-app-manifest/app-manifest.json',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('project state', () => {
  it('writes and reads round-trip, with no secrets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pstate-'));
    tmpDirs.push(dir);
    await writeProjectState(dir, sample({ appId: 'APP123' }));
    const read = await readProjectState(dir);
    expect(read.appId).toBe('APP123');
    expect(read.templateId).toBe('chat-ai-assistant');
    const raw = await fs.readFile(path.join(dir, STATE_FILE), 'utf8');
    expect(raw).not.toMatch(/secret|sk-ant|client_secret/i);
  });

  it('errors clearly when state is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pstate-'));
    tmpDirs.push(dir);
    await expect(readProjectState(dir)).rejects.toThrow(new RegExp(STATE_FILE));
  });

  it('finds the project root by walking up from a nested dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pstate-'));
    tmpDirs.push(dir);
    await writeProjectState(dir, sample());
    const nested = path.join(dir, 'src', 'deep');
    await fs.mkdir(nested, { recursive: true });
    expect(await findProjectRoot(nested)).toBe(dir);
    const loaded = await loadProjectState(nested);
    expect(loaded.dir).toBe(dir);
    expect(loaded.state.projectName).toBe('chat-agent');
  });

  it('returns null root when none exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pstate-'));
    tmpDirs.push(dir);
    expect(await findProjectRoot(dir)).toBeNull();
  });

  it('updates state and stamps updatedAt', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pstate-'));
    tmpDirs.push(dir);
    await writeProjectState(dir, sample());
    const updated = await updateProjectState(dir, { appId: 'NEW' }, () => '2026-02-02T00:00:00.000Z');
    expect(updated.appId).toBe('NEW');
    expect(updated.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });
});
