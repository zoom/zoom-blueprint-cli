import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Never let a developer's saved CLI login or remote network access affect the mocked suite.
const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-tests-auth-'));
process.env.ZOOM_AUTH_DIR = authDir;
process.env.ZOOM_BLUEPRINT_DIR = path.join(authDir, 'blueprints');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Unmocked external HTTP request forbidden in tests.');
  }
  return nativeFetch(input, init);
};
afterAll(() => fs.rmSync(authDir, { recursive: true, force: true }));
