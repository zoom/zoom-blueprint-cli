import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPkce, authorizationUrl, listenForAuthorization, requestPublicToken, getPublicAccessToken } from '../../src/auth/pkce.js';
import { readSession, saveSession, sessionPath, withSessionLock, type OAuthSession } from '../../src/auth/store.js';
import { getEnv, getZoomCredentials } from '../../src/config/env.js';
import { getZoomAccessToken } from '../../src/marketplace/client.js';
import { login, logout, authStatus } from '../../src/commands/auth.js';
import { renderAuthorizationPage } from '../../src/auth/redirect-page.js';

let dir: string;
const env = getEnv('prod');
const nativeFetch = globalThis.fetch;
const session = (patch: Partial<OAuthSession> = {}): OAuthSession => ({version:1,environment:'prod',clientId:'public-id',accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000,scopes:['marketplace:read:app','marketplace:write:app'],...patch});
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(),'zoom-pkce-'));vi.stubEnv('ZOOM_AUTH_DIR',dir); });
afterEach(async () => { vi.unstubAllGlobals();vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(dir,{recursive:true,force:true}); });

describe('public PKCE login', () => {
 it('uses S256, independent random state, and the public ID without a client secret', () => {
  const a=createPkce(), b=createPkce();
  expect(a.verifier).toHaveLength(43);expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
  expect(a.state).not.toBe(b.state);expect(a.verifier).not.toBe(b.verifier);
  const url = new URL(authorizationUrl(env,'public-id','http://127.0.0.1:3000/callback',a));
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.has('client_secret')).toBe(false);
  expect(url.searchParams.has('code_verifier')).toBe(false);expect(url.origin).toBe('https://zoom.us');
 });
 it('rejects wrong state and replays, renders a safe branded page, and releases the listener', async () => {
  const listener = await listenForAuthorization('expected-state',0,2000);
  const uri=listener.redirectUri;
  try {
   expect((await nativeFetch(uri+'?state=wrong&code=private-code')).status).toBe(400);
   const response=await nativeFetch(uri+'?state=expected-state&code=private-code');
   expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
   expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
   const html=await response.text();expect(html).toContain('Blueprint CLI');expect(html).toContain('Continue in your terminal');
   expect(html).not.toContain('private-code');expect(html).not.toContain('expected-state');expect(html).toContain('history.replaceState');
   expect(await listener.code).toBe('private-code');expect((await nativeFetch(uri+'?state=expected-state&code=replayed')).status).toBe(400);
  } finally {await listener.close();}
  await expect(nativeFetch(uri)).rejects.toThrow();
 });
 it('handles OAuth denial and timeout without leaking listener/signal handlers', async () => {
  const count=process.listenerCount('SIGINT');
  const denied=await listenForAuthorization('state',0,2000);
  try {await nativeFetch(denied.redirectUri+'?state=state&error=access_denied');await expect(denied.code).rejects.toThrow('declined');}
  finally {await denied.close();}
  const timed=await listenForAuthorization('state',0,10);
  try {await expect(timed.code).rejects.toThrow('timed out');}finally{await timed.close();}
  expect(process.listenerCount('SIGINT')).toBe(count);
 });
 it('exchanges through a real loopback callback, persists protected tokens and logs no token or verifier', async () => {
  const logged=vi.spyOn(console,'log').mockImplementation(()=>{});
  const token=vi.fn(async (_env,fields) => {
   expect(fields.client_id).toBe('public-id');expect(fields.code).toBe('authorization-code');expect(fields.code_verifier).toHaveLength(43);
   return {access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:'marketplace:read:app marketplace:write:app'};
  });
  await fs.writeFile(path.join(dir,'.env'),'ZOOM_PUBLIC_CLIENT_ID=public-id\n');
  expect(await login({},{candidates:[path.join(dir,'.env')],token,open:async address=>{
   const url=new URL(address),callback=new URL(url.searchParams.get('redirect_uri')!);
   callback.search=new URLSearchParams({state:url.searchParams.get('state')!,code:'authorization-code'}).toString();
   expect((await nativeFetch(callback)).status).toBe(200);
  }})).toBe(0);
  expect(token).toHaveBeenCalledOnce();expect(readSession('prod')?.clientId).toBe('public-id');
  if(process.platform!=='win32')expect((await fs.stat(sessionPath('prod'))).mode & 0o777).toBe(0o600);
  const output=logged.mock.calls.flat().join('\n');expect(output).not.toContain('private-access');expect(output).not.toContain('private-refresh');
  expect(output).toContain('has not been verified');
 });
 it('uses the configured public client ID instead of a stale saved ID', async () => {
  await saveSession(session({clientId:'stale-id'}));vi.stubEnv('ZOOM_PUBLIC_CLIENT_ID','public-id');vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await login({}, {listen:async()=>({redirectUri:'http://127.0.0.1:3000/callback',code:Promise.resolve('code'),close:async()=>{}}),open:async()=>{},token:async(_env,fields)=>{
   expect(fields.client_id).toBe('public-id');return {access_token:'new-access',refresh_token:'new-refresh',expires_in:3600};
  }})).toBe(0);
 });
 it('sends no Basic header and never includes secrets in error messages', async () => {
  const request=vi.fn(async (_url,_init)=>new Response(JSON.stringify({access_token:'a',refresh_token:'r',expires_in:3600})));
  await requestPublicToken(env,{grant_type:'authorization_code',client_id:'public-id',code_verifier:'private-verifier',code:'private-code'},request as typeof fetch);
  const init=request.mock.calls[0][1];expect(init.headers).not.toHaveProperty('Authorization');expect(String(init.body)).not.toContain('client_secret');
  await expect(requestPublicToken(env,{},async()=>new Response('private-server-secret',{status:400}))).rejects.toThrow('HTTP 400');
  await expect(requestPublicToken(env,{},async()=>new Response('{}'))).rejects.toThrow('incomplete');
  await expect(requestPublicToken(env,{},async()=>new Response('private-raw-token-response'))).rejects.toThrow('invalid OAuth response');
 });
 it('refreshes once concurrently, persists the rotated refresh token, and retains scope metadata', async () => {
  await saveSession(session({expiresAt:0}));
  const request=vi.fn(async (_url,init)=>{
   expect(String(init.body)).toContain('grant_type=refresh_token');expect(String(init.body)).toContain('client_id=public-id');
   expect(init.headers).not.toHaveProperty('Authorization');
   return new Response(JSON.stringify({access_token:'next-access',refresh_token:'next-refresh',expires_in:3600}));
  });vi.stubGlobal('fetch',request);
  expect(await Promise.all([getPublicAccessToken(env.zoomApiBase),getZoomAccessToken({zoomApiBase:env.zoomApiBase,publicOAuth:true})])).toEqual(['next-access','next-access']);
  expect(request).toHaveBeenCalledOnce();expect(readSession('prod')?.refreshToken).toBe('next-refresh');expect(readSession('prod')?.scopes).toContain('marketplace:write:app');
 });
 it('does not use a session in a different environment or fall back to S2S after an OAuth refresh rejection', async () => {
  await saveSession(session({expiresAt:0}));
  vi.stubEnv('ZOOM_S2S_ACCOUNT_ID','legacy-account');vi.stubEnv('ZOOM_S2S_CLIENT_ID','legacy-client');vi.stubEnv('ZOOM_S2S_CLIENT_SECRET','legacy-secret');
  expect(getZoomCredentials().creds.publicOAuth).toBe(true);
  expect(() => getEnv('dev')).toThrow('Unknown environment');
  await expect(getPublicAccessToken('https://untrusted.example')).rejects.toThrow('unknown Zoom host');
  const request=vi.fn(async()=>new Response('{}',{status:400}));vi.stubGlobal('fetch',request);
  await expect(getZoomAccessToken({zoomApiBase:env.zoomApiBase,...getZoomCredentials().creds})).rejects.toThrow('public OAuth');expect(request).toHaveBeenCalledOnce();
 });
 it('serializes operations on the session and clears local credentials even when revocation fails', async () => {
  await saveSession(session());const sequence:string[]=[];
  await Promise.all([withSessionLock('prod',async()=>{sequence.push('first');await new Promise(r=>setTimeout(r,20));sequence.push('done');}),withSessionLock('prod',async()=>{sequence.push('second');})]);
  expect(sequence).toHaveLength(3);expect(sequence.indexOf('done')).toBe(sequence.indexOf('first')+1);vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
  vi.spyOn(console,'log').mockImplementation(()=>{});expect(await logout({env:'prod'})).toBe(1);expect(readSession('prod')).toBeUndefined();
 });
 it('reports local status without tokens and supports clearing corrupt session data', async () => {
  await saveSession(session());const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  expect(await authStatus({})).toBe(0);expect(log.mock.calls.flat().join('\n')).not.toContain('private-access');
  await fs.writeFile(sessionPath('prod'),'not-json');expect(()=>readSession('prod')).toThrow('invalid');
  expect(await logout({})).toBe(1);expect(readSession('prod')).toBeUndefined();
 });
 it('keeps redirect failure copy distinct from successful authorization', () => {
  const declined=renderAuthorizationPage('declined','test-nonce');expect(declined).toContain('Sign-in was cancelled');expect(declined).toContain('zoom login');expect(declined).not.toContain('You are signed in');
 });
});
