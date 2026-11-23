import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it, expect, vi, afterEach } from 'vitest';
import { getZoomCredentials } from '../../src/config/env.js';
import { login } from '../../src/commands/auth.js';
import { getZoomAccessToken } from '../../src/marketplace/client.js';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('never treats runtime or legacy secrets as management authentication', async () => {
  vi.stubEnv('ZOOM_S2S_ACCOUNT_ID','legacy');vi.stubEnv('ZOOM_S2S_CLIENT_ID','legacy');vi.stubEnv('ZOOM_S2S_CLIENT_SECRET','legacy');
  vi.stubEnv('ZOOM_CLIENT_ID','runtime');vi.stubEnv('ZOOM_CLIENT_SECRET','runtime');
  expect(getZoomCredentials().ok).toBe(false);
  const request=vi.spyOn(globalThis,'fetch');
  await expect(getZoomAccessToken({zoomApiBase:'https://zoom.us',accountId:'legacy',clientId:'legacy',clientSecret:'legacy'})).rejects.toThrow(/zoom login/);
  expect(request).not.toHaveBeenCalled();
});
it('explains .env setup before opening a browser when public ID is absent', async () => {
  vi.stubEnv('ZOOM_PUBLIC_CLIENT_ID','');const listen=vi.fn();
  await expect(login({}, {candidates:[],listen})).rejects.toThrow(/ZOOM_PUBLIC_CLIENT_ID.*.env/);
  expect(listen).not.toHaveBeenCalled();
});

it('reads an explicit dotenv candidate and lets the shell override it', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zoom-login-config-'));
 const file=path.join(dir,'.env');
 try {
  await fs.writeFile(file,'ZOOM_PUBLIC_CLIENT_ID=file-public-id\n');
  vi.stubEnv('ZOOM_PUBLIC_CLIENT_ID','');
  const listen=vi.fn(async()=>{throw new Error('stop before browser');});
  await expect(login({}, {candidates:[file],listen})).rejects.toThrow('stop before browser');
  expect(listen).toHaveBeenCalledOnce();
  vi.stubEnv('ZOOM_PUBLIC_CLIENT_ID','invalid shell value');listen.mockClear();
  await expect(login({}, {candidates:[file],listen})).rejects.toThrow(/ZOOM_PUBLIC_CLIENT_ID/);
  expect(listen).not.toHaveBeenCalled();
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
