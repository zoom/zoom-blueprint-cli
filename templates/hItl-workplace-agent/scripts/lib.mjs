import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolveConfig() {
  const values = {};
  try {
    for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pick = (key, fallback) => process.env[key] ?? values[key] ?? fallback;
  return { backendOrigin: pick('EXPRESS_ORIGIN', `http://127.0.0.1:${pick('PORT', '4000')}`),
    frontendPort: pick('FRONTEND_PORT', '3000'), root: fileURLToPath(new URL('..', import.meta.url)) };
}
