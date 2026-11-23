import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dev } from '../../src/commands/dev.js';
import { makeProject, validManifest } from '../helpers/project.js';
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); vi.restoreAllMocks(); });
async function fixture() {
  const project = await makeProject({ state: { templateId: 'hitl-workplace-agent' }, manifest: validManifest() });
  cleanup = project.cleanup;
  for (const [directory, pkg] of Object.entries({ '.': { devDependencies: { concurrently: '*' } }, backend: { dependencies: { express: '*' } }, frontend: { dependencies: { next: '*', react: '*' } } })) {
    await fs.mkdir(path.join(project.dir, directory), { recursive: true });
    await fs.writeFile(path.join(project.dir, directory, 'package.json'), JSON.stringify(pkg));
  }
  return project;
}
async function installed(dir: string, subdir: string, name: string) {
  const target = path.join(dir, subdir, 'node_modules', name);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name }));
}
it('catches missing Next.js in a partial frontend install before any server or tunnel starts', async () => {
  const project = await fixture();
  await installed(project.dir, '.', 'concurrently'); await installed(project.dir, 'backend', 'express'); await installed(project.dir, 'frontend', 'react');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  const startServer = vi.fn(), startTunnel = vi.fn();
  expect(await dev({}, { cwd: project.dir, hasNgrokToken: () => true, startServer, startTunnel })).toBe(1);
  expect(startServer).not.toHaveBeenCalled(); expect(startTunnel).not.toHaveBeenCalled();
  const output = log.mock.calls.flat().join('\n');
  expect(output).toContain('frontend: missing next'); expect(output).toContain('npm run install:all');
});
it('catches a missing root devDependency even when backend and frontend are installed', async () => {
  const project = await fixture();
  await installed(project.dir, 'backend', 'express'); await installed(project.dir, 'frontend', 'next'); await installed(project.dir, 'frontend', 'react');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  const startTunnel = vi.fn();
  expect(await dev({}, { cwd: project.dir, startTunnel })).toBe(1);
  expect(startTunnel).not.toHaveBeenCalled(); expect(log.mock.calls.flat().join('\n')).toContain('root: missing concurrently');
});
it('allows a fully installed multi-package project to reach startup', async () => {
  const project = await fixture();
  await installed(project.dir, '.', 'concurrently'); await installed(project.dir, 'backend', 'express'); await installed(project.dir, 'frontend', 'next'); await installed(project.dir, 'frontend', 'react');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const startServer = vi.fn(async () => ({ stop: async () => {} }));
  expect(await dev({ yes: true, noSync: true }, {
    cwd: project.dir, startServer, hasNgrokToken: () => true,
    startTunnel: async () => ({ url: 'https://fixture.ngrok.app', close: async () => {} }),
    waitForReady: async () => true, waitForShutdown: async () => {},
    reconcile: async () => ({ envPath: '', changes: [], unresolved: [], wrote: false }),
  })).toBe(0);
  expect(startServer).toHaveBeenCalledOnce();
});
