import { syncTemplateIgnores } from './sync-template-ignores.mjs';
// Make the compiled CLI entry executable (tsc preserves the shebang but not the +x bit).
import { chmod } from 'node:fs/promises';
const entry = new URL('../dist/index.js', import.meta.url);
try {
  await chmod(entry, 0o755);
} catch (err) {
  console.warn(`postbuild: could not chmod ${entry.pathname}: ${err.message}`);
}

// npm strips dot-prefixed ignore files; ship portable copies for scaffolding.
await syncTemplateIgnores();
