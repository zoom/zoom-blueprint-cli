import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {run} from '../../src/cli.js';
import {promptAppType} from '../../src/prompts.js';
it('rejects retired app types before scaffolding or Marketplace requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zoom-general-only-'));
 const fetch=vi.spyOn(globalThis,'fetch');const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try {
  await expect(run({name:'retired',appType:'s2s' as any,template:'hitl-workplace-agent',outDir:dir,yes:true})).rejects.toThrow(/Only General Apps/);
  expect(await fs.readdir(dir)).toEqual([]);expect(fetch).not.toHaveBeenCalled();
  expect(await promptAppType()).toBe('general');
  await expect(promptAppType('s2s' as any)).rejects.toThrow(/Only General Apps/);
 } finally {fetch.mockRestore();log.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
});
