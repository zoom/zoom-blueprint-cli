import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../../src/commands/dev-runtime.js';
import { dev } from '../../src/commands/dev.js';
import { makeProject, validManifest } from '../helpers/project.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('keeps management and tunnel credentials out of real child processes while retaining runtime credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'credential-isolation-'));
  const file = path.join(dir, 'observed.json');
  for (const key of ['ZOOM_S2S_ACCOUNT_ID','ZOOM_S2S_CLIENT_ID','ZOOM_S2S_CLIENT_SECRET','NGROK_AUTHTOKEN']) vi.stubEnv(key, 'fake-cli-only-value');
  const child = await startServer({ cwd: dir, port: 45678,
    command: [process.execPath, '-e', 'require("fs").writeFileSync(process.argv[1],JSON.stringify({keys:Object.keys(process.env).filter(k=>k.startsWith("ZOOM_S2S_")||k==="NGROK_AUTHTOKEN"),runtime:process.env.ZOOM_CLIENT_SECRET,ai:process.env.ANTHROPIC_API_KEY}));setInterval(()=>{},1000)', file],
    env: { ZOOM_CLIENT_SECRET: 'fake-runtime-secret', ANTHROPIC_API_KEY: 'sk-ant-fake-runtime-key' },
  });
  try {
    let content: string | undefined;
    for (let i=0;i<100;i++) { try { content=await fs.readFile(file,'utf8'); break; } catch {} await new Promise(resolve=>setTimeout(resolve,10)); }
    expect(content).toBeDefined();
    expect(JSON.parse(content!)).toEqual({keys:[],runtime:'fake-runtime-secret',ai:'sk-ant-fake-runtime-key'});
  } finally { await child.stop(); await fs.rm(dir,{recursive:true,force:true}); }
});
it('reports independent server and tunnel cleanup failures without leaking secrets', async () => {
  const project = await makeProject({ manifest: validManifest() });
  const log = vi.spyOn(console,'log').mockImplementation(()=>{});
  const close = vi.fn(async()=>{throw new Error('client_secret=fake-cleanup-secret');});
  const stop = vi.fn(async()=>{throw new Error('token=fake-cleanup-token');});
  try {
    expect(await dev({yes:true,noSync:true},{cwd:project.dir,hasNgrokToken:()=>true,
      startTunnel:async()=>({url:'https://fixture.ngrok.app',close}),startServer:async()=>({stop}),
      waitForReady:async()=>true,waitForShutdown:async()=>{},
      reconcile:async()=>({envPath:'',changes:[],unresolved:[],wrote:false}),
    })).toBe(0);
    expect(close).toHaveBeenCalledOnce();expect(stop).toHaveBeenCalledOnce();
    const output=log.mock.calls.flat().join('\n');
    expect(output).toContain('cleanup did not complete');
    expect(output).not.toContain('fake-cleanup-secret');expect(output).not.toContain('fake-cleanup-token');
  } finally { await project.cleanup(); }
});
