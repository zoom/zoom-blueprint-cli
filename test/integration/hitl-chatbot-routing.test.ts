import {it,expect} from 'vitest';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
it('routes HITL chatbot replies using isolated verified-event identity instead of placeholder env values',()=>{
 const output=execFileSync(process.execPath,['test/helpers/chatbot-routing.mjs',path.resolve('templates/hitl-workplace-agent')],{encoding:'utf8'});
 expect(output).toContain('Verified event account');
});
