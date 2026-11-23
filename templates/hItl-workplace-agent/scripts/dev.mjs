import { spawn } from 'node:child_process';
import { resolveConfig } from './lib.mjs';

const config = resolveConfig();
console.log('\nZoom Meeting Intelligence & Approvals\n  Backend: ' + config.backendOrigin + '\n');
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', 'concurrently', '--kill-others-on-fail', '--names', 'EXPRESS,NEXT', '--prefix-colors', 'cyan,magenta',
    'npm run dev:backend', 'node scripts/start-frontend.mjs'], { cwd: config.root, stdio: 'inherit' });
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopped = true; child.kill(signal); });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('close', (code, signal) => { process.exitCode = stopped ? 130 : code ?? (signal ? 1 : 0); });
