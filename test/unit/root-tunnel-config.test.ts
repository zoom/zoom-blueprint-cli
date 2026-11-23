import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRootTunnelConfig } from '../../src/config/management-creds.js';
import { loadDotenv } from '../../src/config/dotenv.js';

let dir: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

it('loads the root tunnel token even without Marketplace credentials', () => {
  vi.stubEnv('NGROK_AUTHTOKEN', '');
  expect(loadRootTunnelConfig(['/root/.env'], () => ({ NGROK_AUTHTOKEN: 'root-token' }))).toBe('/root/.env');
  expect(process.env.NGROK_AUTHTOKEN).toBe('root-token');
});

it('preserves an explicitly exported token', () => {
  vi.stubEnv('NGROK_AUTHTOKEN', 'shell-token');
  loadRootTunnelConfig(['/root/.env'], () => ({ NGROK_AUTHTOKEN: 'root-token' }));
  expect(process.env.NGROK_AUTHTOKEN).toBe('shell-token');
});

it('ignores a legacy app token while loading runtime variables', async () => {
  vi.stubEnv('NGROK_AUTHTOKEN', '');
  vi.stubEnv('SITE_URL', '');
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-tunnel-config-'));
  const file = path.join(dir, '.env');
  await fs.writeFile(file, 'NGROK_AUTHTOKEN=app-token\nSITE_URL=https://example.com\n');
  loadDotenv(file, { override: true, exclude: ['NGROK_AUTHTOKEN'] });
  expect(process.env.NGROK_AUTHTOKEN).toBe('');
  expect(process.env.SITE_URL).toBe('https://example.com');
});
