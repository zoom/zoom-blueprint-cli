import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { warnUnverifiedNode, VERIFIED_NODE_VERSION } from '../../src/util/node-version.js';
import { run } from '../../src/cli.js';
import { dev } from '../../src/commands/dev.js';
import { appCreate } from '../../src/commands/app-create.js';

describe('verified Node version policy', () => {
  afterEach(() => vi.restoreAllMocks());
  it('accepts the verified runtime', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => warnUnverifiedNode('22.23.5')).not.toThrow();
    expect(output).not.toHaveBeenCalled();
  });

  it.each(['18.20.0', '22.22.2', '22.23.6', '23.6.0', '24.15.0', '26.0.0', '22.23.5-rc.1'])(
    'warns for unverified %s without throwing', (version) => {
      const output = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => warnUnverifiedNode(version)).not.toThrow();
      const message = output.mock.calls.flat().join('\n');
      expect(message).toContain(version);
      expect(message).toContain('Continuing with your current version');
      expect(message).toContain('nvm install 22.23.5');
      expect(message).toContain('nvm use 22.23.5');
    },
  );

  it('continues into normal command validation on an unverified runtime', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
    Object.defineProperty(process.versions, 'node', { ...descriptor, value: '23.6.0' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Missing inputs still fail normally; the Node warning itself does not stop execution.
      await expect(run({ yes: true })).rejects.toThrow(/name/i);
      await expect(dev({}, { cwd: '/nonexistent-node-check-project' })).rejects.toThrow(/project/i);
      await expect(appCreate({}, { cwd: '/nonexistent-node-check-project' })).rejects.toThrow(/project/i);
      expect(output.mock.calls.flat().join('\n')).toContain('Continuing with your current version');
    } finally {
      Object.defineProperty(process.versions, 'node', descriptor);
    }
  });

  it('keeps package engines, lockfiles and version pins aligned', () => {
    const folders = ['.', 'templates/chatbot-services', 'templates/hitl-workplace-agent',
      'templates/hitl-workplace-agent/backend', 'templates/hitl-workplace-agent/frontend', 'templates/zcc-nextjs-sample'];
    for (const folder of folders) {
      const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
      const lock = JSON.parse(fs.readFileSync(path.join(folder, 'package-lock.json'), 'utf8'));
      expect(pkg.engines.node).toBe(VERIFIED_NODE_VERSION);
      expect(lock.packages[''].engines.node).toBe(VERIFIED_NODE_VERSION);
      if (!['backend', 'frontend'].includes(path.basename(folder)))
        expect(fs.readFileSync(path.join(folder, '.nvmrc'), 'utf8').trim()).toBe(VERIFIED_NODE_VERSION);
    }
  });
});
