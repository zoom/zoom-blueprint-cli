import { spawn } from 'node:child_process';
import { resolveConfig } from './lib.mjs';
import { waitForBackend } from './backend-readiness.mjs';

const cfg = resolveConfig();
const port = Number(cfg.frontendPort);
const controller = new AbortController();
let child;
const stop = signal => {
  controller.abort(new Error('Development stopped'));
  child?.kill(signal);
};
const onInt = () => stop('SIGINT');
const onTerm = () => stop('SIGTERM');
process.once('SIGINT', onInt);
process.once('SIGTERM', onTerm);

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FRONTEND_PORT must be a valid TCP port.');
  await waitForBackend(cfg.backendOrigin, { signal: controller.signal });
  controller.signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['--prefix', 'frontend', 'run', 'dev', '--', '--port', String(port)], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      process.exitCode = controller.signal.aborted ? 130 : (code ?? (signal ? 1 : 0));
      resolve();
    });
  });
} catch (error) {
  if (controller.signal.aborted) process.exitCode = 130;
  else { console.error(error.message); process.exitCode = 1; }
} finally {
  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);
}
