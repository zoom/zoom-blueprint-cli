import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {doctor,runDoctor} from '../../src/commands/doctor.js';
import {makeProject,validManifest} from '../helpers/project.js';
const ids=['chat-ai-assistant','hitl-workplace-agent','zcc-nextjs-sample'] as const;
const cleanup: (()=>Promise<void>)[]=[];
let output: ReturnType<typeof vi.spyOn>;
beforeEach(()=>{output=vi.spyOn(console,'log').mockImplementation(()=>{});vi.stubEnv('OPENAI_API_KEY','');vi.stubEnv('ANTHROPIC_API_KEY','');});
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();vi.restoreAllMocks();vi.unstubAllEnvs();});
const values=()=>({ZOOM_CLIENT_ID:'opaque-client-id-123',ZOOM_CLIENT_SECRET:'Sensitive.[client]+secret-123',ZOOM_ACCOUNT_ID:'account-123',ZOOM_BOT_JID:'bot-id@xmpp.zoom.us',ZOOM_VERIFICATION_TOKEN:'Sensitive.[webhook]+token-123',SESSION_SECRET:'Sensitive.[session]+secret-123',SITE_URL:'https://dev.example.test',ZOOM_REDIRECT_URI:'https://dev.example.test/auth/callback',PUBLIC_BASE_URL:'https://dev.example.test',WEBVIEW_URL:'https://dev.example.test/webview',FRONTEND_ORIGIN:'https://dev.example.test',ZOOM_BOT_NAME:'Demo Bot',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''});
async function project(id: typeof ids[number],patch: Record<string,string>={},linked=false){const p=await makeProject({state:{templateId:id,lastDevUrl:'https://dev.example.test',...(linked?{appId:'APP-TEST'}:{})},manifest:validManifest(),env:{...values(),...patch}});cleanup.push(p.cleanup);return p;}
const offline=()=>({ok:false,creds:{},missing:['zoom login']});
const named=(results:Awaited<ReturnType<typeof runDoctor>>,name:string)=>results.find(r=>r.name===name)!;
const placeholders=['','   ','""',"''",'your_client_id_here','{{ZOOM_CLIENT_ID}}','changeme','placeholder','todo','xxx','app-client-id','sk-...'];
it.each(ids.flatMap(id=>placeholders.map(value=>({id,value}))))('$id rejects required placeholder "$value"',async({id,value})=>{
 const p=await project(id,{ZOOM_CLIENT_ID:value});const session=vi.fn();
 const results=await runDoctor({cwd:p.dir,getCreds:offline,openSession:session});
 expect(named(results,'Required env vars set').status).toBe('fail');expect(named(results,'ZOOM_CLIENT_ID').status).toBe('fail');
 expect(named(results,'ZOOM_CLIENT_ID').detail).toContain('project .env');expect(named(results,'Remote Marketplace validation').status).toBe('skip');expect(session).not.toHaveBeenCalled();
});
it.each(ids)('%s accepts opaque credentials locally, leaves optional AI disabled, and returns success',async id=>{
 const p=await project(id);const results=await runDoctor({cwd:p.dir,getCreds:offline});
 expect(named(results,'Required env vars set').status).toBe('pass');
 expect(named(results,'ZOOM_CLIENT_SECRET').detail).toContain('access has not been verified');
 const ai=results.filter(r=>r.name==='Zoom Chat research'||r.name==='Meeting intelligence and approvals'||r.name==='Zoom document creation');
 if(id==='zcc-nextjs-sample')expect(ai).toHaveLength(0);else {expect(ai.length).toBeGreaterThan(0);for(const feature of ai){expect(feature.status).toBe('warn');expect(feature.detail).toContain('Disabled.');}}
 expect(await doctor({cwd:p.dir,getCreds:offline})).toBe(0);
 const text=output.mock.calls.flat().join('\n');for(const secret of [values().ZOOM_CLIENT_SECRET,values().ZOOM_VERIFICATION_TOKEN,values().SESSION_SECRET])expect(text).not.toContain(secret);
});
it.each(ids)('%s rejects invalid runtime URLs without displaying them',async id=>{
 const name=id==='chat-ai-assistant'?'WEBVIEW_URL':id==='hitl-workplace-agent'?'PUBLIC_BASE_URL':'SITE_URL';
 for(const value of ['not-a-url','http://dev.example.test','https://user:embedded-password@dev.example.test']){
  const p=await project(id,{[name]:value});const results=await runDoctor({cwd:p.dir,getCreds:offline});
  const check=results.find(r=>r.name.endsWith(' resolved')&&r.detail?.includes(name));expect(check?.status).toBe('fail');
  expect(JSON.stringify(results)).not.toContain(value);expect(JSON.stringify(results)).not.toContain('embedded-password');
 }
});
it.each(ids)('%s rejects missing required secrets and reports a failing exit code',async id=>{
 const p=await project(id,{ZOOM_CLIENT_SECRET:'""'});expect(await doctor({cwd:p.dir,getCreds:offline})).toBe(1);
 expect(output.mock.calls.flat().join('\n')).toContain('ZOOM_CLIENT_SECRET');
});
it.each(ids.slice(0,2))('%s applies the shared Bot JID and Secret Token validators',async id=>{
 const p=await project(id,{ZOOM_BOT_JID:'not-a-jid',ZOOM_VERIFICATION_TOKEN:'abc'});
 const results=await runDoctor({cwd:p.dir,getCreds:offline});
 expect(named(results,'Bot JID configured').status).toBe('fail');expect(named(results,'Bot JID configured').detail).toContain('expected the form');
 expect(named(results,'Secret token configured').status).toBe('fail');expect(named(results,'Secret token configured').detail).toContain('too short');
 expect(JSON.stringify(results)).not.toContain('not-a-jid');expect(JSON.stringify(results)).not.toContain('abc');
});
it.each(ids)('%s redacts exact configured secrets from remote errors and rendered output',async id=>{
 const p=await project(id,{},true);const secrets=[values().ZOOM_CLIENT_SECRET,values().ZOOM_VERIFICATION_TOKEN,values().SESSION_SECRET];
 const error=new Error('Remote failure: '+secrets.join(' / ')+' encoded='+encodeURIComponent(secrets[0])+' access_token="remote-token-sentinel"');
 const deps={cwd:p.dir,getCreds:()=>({ok:true,creds:{publicOAuth:true},missing:[]}),openSession:vi.fn(async()=>{throw error;})};
 const results=await runDoctor(deps);expect(named(results,'Remote Marketplace validation').status).toBe('fail');expect(await doctor(deps)).toBe(1);
 for(const secret of [...secrets,encodeURIComponent(secrets[0]),'remote-token-sentinel']){expect(JSON.stringify(results)).not.toContain(secret);expect(output.mock.calls.flat().join('\n')).not.toContain(secret);}
});
it('warns on malformed optional AI configuration and never calls providers',async()=>{
 const p=await project('hitl-workplace-agent',{OPENAI_API_KEY:'sk-...',ANTHROPIC_API_KEY:'sk-ant-...'});const fetch=vi.spyOn(globalThis,'fetch');
 const results=await runDoctor({cwd:p.dir,getCreds:offline});
 for(const name of ['Zoom Chat research','Meeting intelligence and approvals','Zoom document creation'])expect(named(results,name).status).toBe('warn');expect(fetch).not.toHaveBeenCalled();
});
