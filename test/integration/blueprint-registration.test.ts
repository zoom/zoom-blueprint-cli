import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blueprintRegister, blueprintInspect, blueprintList, blueprintUnregister } from '../../src/commands/blueprint.js';
import { blueprintDirectory, inspectRegistration } from '../../src/templates/catalog.js';
import { parseDefinition } from '../../src/templates/definition.js';
import { getTemplate, compatibleTemplates, TEMPLATES, templateDefinition } from '../../src/templates/registry.js';
import { run } from '../../src/cli.js';
import { dev } from '../../src/commands/dev.js';
import { appDiff } from '../../src/commands/app.js';
import { configure } from '../../src/commands/configure.js';
import { readProjectState, updateProjectState } from '../../src/config/project-state.js';
import { validManifest, fakeSession } from '../helpers/project.js';

let root: string, source: string;
let definition: any;
let output: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
 root = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-register-test-')); source = path.join(root, 'sample');
 vi.stubEnv('ZOOM_BLUEPRINT_DIR', path.join(root, 'catalog')); await fs.mkdir(source);
 output = vi.spyOn(console, 'log').mockImplementation(() => {});
 const manifest = validManifest('{{APP_NAME}}');
 manifest.manifest.oauth_information.development_redirect_uri = '{{DEV_BASE_URL}}/auth/callback';
 manifest.manifest.oauth_information.scopes = [{ scope: 'user:read:user' }];
 definition = { schemaVersion: 1, id: 'local-demo', name: 'Local Demo', description: 'A local Zoom sample', manifestPath: 'manifest.json',
 requiredEnv: [], setupCommands: ['npm install'], startCommands: ['npm run dev'],
 runtime: { kind: 'server', devCommand: ['npm', 'run', 'dev'], defaultPort: 3456, portEnv: 'PORT', readinessPath: '/health', dependencyDirs: ['.'],
 urlMappings: [{path: 'oauth_information.development_redirect_uri', route: '/auth/callback', label: 'OAuth callback'}] },
 reconcile: { urlVars: [{name: 'SITE_URL', kind: 'origin'}] } };
 await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({name:'local-demo',description:'Demo',scripts:{dev:'node server.mjs',postinstall:'touch must-not-execute'}}));
 await fs.writeFile(path.join(source, '.env.example'), 'PORT=3456\nSITE_URL=\nZOOM_CLIENT_ID=\nZOOM_CLIENT_SECRET=\n');
 await fs.writeFile(path.join(source, 'README.md'), '# Local sample\n');
 await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
 await fs.writeFile(path.join(source, 'server.mjs'), 'console.log("{{PROJECT_NAME}}");\n');
 await fs.writeFile(path.join(source, 'zoom-blueprint.json'), JSON.stringify(definition));
});
afterEach(async () => {vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(root,{recursive:true,force:true});});
const text = () => output.mock.calls.flat().join('\n');

it('registers a snapshot without running package scripts or making network requests; exposes it through existing discovery', async () => {
 const network = vi.spyOn(globalThis, 'fetch');
 expect(await blueprintRegister(source, {yes:true})).toBe(0);
 expect(network).not.toHaveBeenCalled(); await expect(fs.access(path.join(source,'must-not-execute'))).rejects.toThrow();
 expect(getTemplate('local-demo')?.source.type).toBe('registered');
 expect(compatibleTemplates('general')).toHaveLength(TEMPLATES.length+1);
 const stored=inspectRegistration('local-demo');expect(stored.registration.sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(stored.definition.requiredScopes).toEqual(['user:read:user']);
 expect(await blueprintList()).toBe(0);expect(text()).toContain('local registration');
});

it('excludes private configuration, dependency/build folders and keys while preserving safe examples and executable assets', async () => {
 for(const file of ['.env','.env.local','.npmrc','credentials.json','private.pem']) await fs.writeFile(path.join(source,file),'private-sentinel');
 for(const dir of ['node_modules','.git','dist','.next']) {await fs.mkdir(path.join(source,dir));await fs.writeFile(path.join(source,dir,'private'),'private-sentinel');}
 await fs.writeFile(path.join(source,'.env.test.example'),'EXAMPLE=placeholder');
 await fs.writeFile(path.join(source,'start.sh'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 await blueprintRegister(source,{yes:true});
 const saved=path.join(blueprintDirectory(),'local-demo','files');
 for(const name of ['.env','.env.local','.npmrc','credentials.json','private.pem','node_modules','.git','dist','.next']) await expect(fs.access(path.join(saved,name))).rejects.toThrow();
 expect(await fs.readFile(path.join(saved,'.env.test.example'),'utf8')).toContain('EXAMPLE');
 expect((await fs.stat(path.join(saved,'start.sh'))).mode & 0o111).toBeTruthy();
 expect(await fs.readFile(path.join(source,'.env'),'utf8')).toBe('private-sentinel');
});

it('copies stable source content and stores portable metadata for configure, diff and dev after unregistering', async () => {
 await blueprintRegister(source,{yes:true});
 await fs.writeFile(path.join(source,'server.mjs'),'changed original');
 const out=path.join(root,'projects');
 expect(await run({name:'generated',template:'local-demo',outDir:out,yes:true,create:false})).toBe(0);
 const dir=path.join(out,'generated'),state=await readProjectState(dir);
 expect(await fs.readFile(path.join(dir,'server.mjs'),'utf8')).toContain('generated');
 expect(state.blueprint?.runtime?.defaultPort).toBe(3456);
 expect(JSON.stringify(state.blueprint)).not.toContain(source);
 expect(await fs.readFile(path.join(dir,'.gitignore'),'utf8')).toContain('.env');
 await blueprintUnregister('local-demo',{yes:true});expect(getTemplate('local-demo')).toBeUndefined();
 await fs.rm(source,{recursive:true});
 expect(await configure({yes:true,url:'https://new.example'}, {cwd:dir,getCreds:()=>({ok:false,creds:{},missing:['zoom login']})})).toBe(0);
 expect(await fs.readFile(path.join(dir,'.env'),'utf8')).toContain('SITE_URL=https://new.example');
 await updateProjectState(dir,{appId:'EXISTING'});
 const {session,calls}=fakeSession({initial:validManifest()});
 expect(await appDiff({url:'https://new.example'}, {cwd:dir,getCreds:()=>({ok:true,creds:{publicOAuth:true},missing:[]}),openSession:async()=>session})).toBe(0);
 expect(calls.update).toBe(0);expect(text()).toContain('development_redirect_uri');
 let command: string[]=[];
 expect(await dev({url:'https://new.example',noSync:true,yes:true},{cwd:dir,startServer:async args=>{command=args.command;return{stop:async()=>{}};},waitForReady:async()=>true,checkHealth:async()=>true,waitForShutdown:async()=>{},reconcile:async()=>({envPath:'',changes:[],unresolved:[],wrote:false})})).toBe(0);
 expect(command).toEqual(['npm','run','dev']);
});

it('exports clean JSON that can be reused to register the same sample elsewhere', async () => {
 await blueprintRegister(source,{yes:true});output.mockClear();
 await blueprintInspect('local-demo',{json:true});const exported=JSON.parse(text());
 expect(exported.schemaVersion).toBe(1);expect(exported.source).toBeUndefined();expect(exported.registeredAt).toBeUndefined();
 expect(parseDefinition(exported).id).toBe('local-demo');
 await blueprintUnregister('local-demo',{yes:true});
 await fs.writeFile(path.join(source,'zoom-blueprint.json'),JSON.stringify(exported));
 expect(await blueprintRegister(source,{yes:true})).toBe(0);
});

it('rejects duplicate and bundled IDs without replacing files', async () => {
 await blueprintRegister(source,{yes:true});const before=inspectRegistration('local-demo').registration.sha256;
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow(/already registered/);
 expect(inspectRegistration('local-demo').registration.sha256).toBe(before);
 definition.id='chat-ai-assistant';await fs.writeFile(path.join(source,'zoom-blueprint.json'),JSON.stringify(definition));
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow(/bundled blueprint ID/);
 await expect(blueprintUnregister('chat-ai-assistant',{yes:true})).rejects.toThrow(/Bundled blueprints/);
});

it('supports guided local detection without writing metadata into the original folder', async () => {
 await fs.rm(path.join(source,'zoom-blueprint.json'));
 const prompts: string[]=[];
 expect(await blueprintRegister(source,{}, {ask:async(message,initial)=>{prompts.push(message);return message.includes('What does')?'A guided sample':initial;},confirm:async()=>true,choose:async(_message,choices)=>choices[0],requiredEnv:async()=>[]})).toBe(0);
 expect(prompts).toContain('Blueprint ID');expect(getTemplate('sample')?.runtime?.devCommand).toEqual(['npm','run','dev']);
 expect(getTemplate('sample')?.supportedProviders).toEqual([]);
 await expect(fs.access(path.join(source,'zoom-blueprint.json'))).rejects.toThrow();
});

it('requires a complete definition for --yes and never opens prompts', async () => {
 await fs.rm(path.join(source,'zoom-blueprint.json'));const prompt=vi.fn();
 await expect(blueprintRegister(source,{yes:true},{ask:prompt})).rejects.toThrow(/requires zoom-blueprint.json/);
 expect(prompt).not.toHaveBeenCalled();
});
it('cancels registration and unregister without changing the catalog', async () => {
 expect(await blueprintRegister(source,{}, {confirm:async()=>false})).toBe(0);expect(getTemplate('local-demo')).toBeUndefined();
 await blueprintRegister(source,{yes:true});expect(await blueprintUnregister('local-demo',{}, {confirm:async()=>false})).toBe(0);expect(getTemplate('local-demo')).toBeDefined();
});
it('rejects symlink source files and removes incomplete staging data', async () => {
 await fs.symlink(path.join(source,'README.md'),path.join(source,'linked-file'));
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow(/Symbolic links/);
 expect(await fs.readdir(blueprintDirectory())).toEqual([]);
});
it.each([
 ['manifestPath','../outside.json'],['id','../escape'],['schemaVersion',2],
 ['requiredScopes',['wrong:scope']],['requiredEnv',['MISSING_VARIABLE']],
 ['supportedProviders',['openai']],['runtime',{kind:'server',devCommand:[],defaultPort:3000,readinessPath:'/health'}],
])('rejects invalid %s before saving a registration',async(key,value)=>{
 definition[key]=value;await fs.writeFile(path.join(source,'zoom-blueprint.json'),JSON.stringify(definition));
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow();expect(getTemplate('local-demo')).toBeUndefined();
});
it('rejects mappings that could alter SDK domains, slash commands or object prototypes',()=>{
 for(const field of ['features.domain_allow_list.0.domain','features.team_chat_subscription.slash_command.command','__proto__.polluted']){
  definition.runtime.urlMappings=[{path:field,route:'/'}];expect(()=>parseDefinition(definition)).toThrow(/Unsupported development URL mapping/);
 }
 expect(({} as any).polluted).toBeUndefined();
});
it('reports a corrupt registration and still allows unregistering it',async()=>{
 await blueprintRegister(source,{yes:true});await fs.writeFile(path.join(blueprintDirectory(),'local-demo','zoom-blueprint.json'),'broken');
 expect(()=>getTemplate('local-demo')).toThrow(/unregister local-demo/);
 expect(await blueprintUnregister('local-demo',{yes:true})).toBe(0);expect(getTemplate('local-demo')).toBeUndefined();
});
it('exports bundled definitions using the same schema',()=>{
 for(const template of TEMPLATES) expect(parseDefinition(templateDefinition(template)).id).toBe(template.id);
});

it('rejects a catalog inside the source folder rather than recursively snapshotting it', async()=>{
 vi.stubEnv('ZOOM_BLUEPRINT_DIR',path.join(source,'..catalog'));
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow(/does not contain the blueprint storage/);
 await expect(fs.access(path.join(source,'..catalog'))).rejects.toThrow();
});
it('rejects unknown definition fields and CLI-only values in a runtime example', async()=>{
 expect(()=>parseDefinition({...definition,unexpectedCredential:'not-runtime-metadata'})).toThrow(/Unknown blueprint field/);
 await fs.appendFile(path.join(source,'.env.example'),'NGROK_AUTHTOKEN=placeholder\n');
 await expect(blueprintRegister(source,{yes:true})).rejects.toThrow(/belongs in CLI configuration/);
});

it('asks which public port variable to use for a sample with separate frontend and backend ports', async()=>{
 await fs.rm(path.join(source,'zoom-blueprint.json'));
 await fs.appendFile(path.join(source,'.env.example'),'FRONTEND_PORT=4001\n');
 expect(await blueprintRegister(source,{}, {ask:async(message,initial)=>message.includes('What does')?'Multi package sample':initial,confirm:async()=>true,choose:async(message,choices)=>message.includes('port variable')?'FRONTEND_PORT':choices[0],requiredEnv:async()=>[]})).toBe(0);
 expect(getTemplate('sample')?.runtime?.portEnv).toBe('FRONTEND_PORT');
 expect(getTemplate('sample')?.runtime?.defaultPort).toBe(4001);
});
