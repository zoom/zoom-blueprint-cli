import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveSession } from '../../src/auth/store.js';
import { run } from '../../src/cli.js';
import { appDiff } from '../../src/commands/app.js';
import { authCheck } from '../../src/commands/auth.js';
import { openMarketplaceSession } from '../../src/marketplace/session.js';
import { deleteAppById } from '../../src/marketplace/client.js';

let dir:string;
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'pkce-marketplace-'));vi.stubEnv('ZOOM_AUTH_DIR',path.join(dir,'auth'));vi.spyOn(console,'log').mockImplementation(()=>{});await saveSession({version:1,environment:'prod',clientId:'public-id',accessToken:'oauth-access',refreshToken:'oauth-refresh',expiresAt:Date.now()+3600000,scopes:['marketplace:read:app','marketplace:write:app']});});
afterEach(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(dir,{recursive:true,force:true});});

it('routes create and manifest diff through public OAuth without minting an S2S token or copying login credentials',async()=>{
 let remote:any;const requests:string[]=[];
 const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
  requests.push(url);expect(url).toContain('https://api.zoom.us/v2/marketplace/apps');expect((init.headers as Record<string,string>).Authorization).toBe('Bearer oauth-access');
  if(init.method==='POST' && url.endsWith('/apps')){
   const body=JSON.parse(init.body as string);expect(body.app_type).toBe('general');expect(body.app_name).toBeTruthy();expect(body.contact_email).toBeTruthy();expect(body.company_name).toBeTruthy();
   remote=body.manifest;return new Response(JSON.stringify({app_id:'PKCE-APP',development_credentials:{client_id:'runtime-id',client_secret:'runtime-secret'}}),{status:201});
  }
  return new Response(JSON.stringify({manifest:remote}));
 });vi.stubGlobal('fetch',fetcher);
 expect(await run({name:'pkce-chat',template:'chat-ai-assistant',outDir:dir,yes:true,env:'prod'})).toBe(0);
 const project=path.join(dir,'pkce-chat');const state=JSON.parse(await fs.readFile(path.join(project,'.zoom-agent.json'),'utf8'));
 expect(state.appId).toBe('PKCE-APP');expect(state.appInfo.contactEmail).toBeTruthy();
 const envText=await fs.readFile(path.join(project,'.env'),'utf8');expect(envText).toContain('runtime-secret');expect(envText).not.toContain('oauth-access');expect(envText).not.toContain('oauth-refresh');expect(envText).not.toContain('public-id');
 expect(await appDiff({url:'https://changed.ngrok.app'},{cwd:project,env:'prod'})).toBe(0);
 expect(requests.some(url=>url.includes('/oauth/token'))).toBe(false);
});

it('uses the public token for validation, full manifest update, and delete',async()=>{
 const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
  expect(url.startsWith('https://api.zoom.us/v2/marketplace/')).toBe(true);expect((init.headers as Record<string,string>).Authorization).toBe('Bearer oauth-access');
  return init.method==='PUT'||init.method==='DELETE'?new Response(null,{status:204}):new Response(JSON.stringify({ok:true}));
 });vi.stubGlobal('fetch',fetcher);
 const env={name:'prod',zoomApiBase:'https://zoom.us',marketplaceUrl:'https://marketplace.zoom.us'};
 const session=await openMarketplaceSession({env,creds:{publicOAuth:true}});
 expect((await session.validate({display_information:{display_name:'Test'}})).ok).toBe(true);
 await session.updateManifest('APP',{unchanged:'preserved',oauth_information:{scopes:[]}});
 await deleteAppById({env,appId:'APP',creds:{publicOAuth:true}});
 expect(fetcher.mock.calls.map(([,init])=>init.method)).toEqual(['POST','PUT','DELETE']);
});

it('reports an app-scoped management check honestly without performing writes',async()=>{
 const fetcher=vi.fn(async(url:string,init:RequestInit)=>new Response(JSON.stringify(url.endsWith('/validate')?{ok:true}:{manifest:{display_information:{display_name:'Test'}}})));
 vi.stubGlobal('fetch',fetcher);
 expect(await authCheck({appId:'APP',env:'prod'})).toBe(0);
 expect(fetcher.mock.calls).toHaveLength(2);expect(fetcher.mock.calls[1][1].method).toBe('POST');
 const output=vi.mocked(console.log).mock.calls.flat().join('\n');expect(output).toContain('were not exercised');expect(output).not.toContain('oauth-access');
});

it('scaffolds the pinned official HITL sample without an Agent Memory service or setup path',async()=>{
 const fetcher=vi.fn(()=>{throw new Error('No Marketplace access allowed');});vi.stubGlobal('fetch',fetcher);
 expect(await run({name:'hitl-official',template:'hitl-workplace-agent',outDir:dir,yes:true,create:false})).toBe(0);
 const project=path.join(dir,'hitl-official');const pkg=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
 expect(pkg.scripts.dev).toBe('node scripts/dev.mjs');expect(Object.keys(pkg.scripts).some(k=>k.includes('memory'))).toBe(false);
 await expect(fs.access(path.join(project,'memory-service'))).rejects.toThrow();
 const env=await fs.readFile(path.join(project,'.env'),'utf8');expect(env).not.toContain('AGENT_MEMORY');expect(env).not.toContain('MEMORY_SERVICE');
 const api=await fs.readFile(path.join(project,'backend/routes/api/index.js'),'utf8');expect(api).not.toContain('memory');
 expect(await fs.readFile(path.join(project,'README.md'),'utf8')).toContain('66a3740723b032a87457e2f41d6ad52cc33b0b7d');expect(fetcher).not.toHaveBeenCalled();
});
