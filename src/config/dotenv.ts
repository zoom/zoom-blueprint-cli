// Minimal .env loader for the CLI itself (zero-dependency). The CLI reads Zoom credentials and the
// provider key from process.env; developers keep them in a local .env, so we load that file at
// startup. Real environment variables always win — a value already set in process.env is never
// overwritten.

import fs from 'node:fs';
import path from 'node:path';

export interface LoadDotenvResult {
  path: string;
  loaded: boolean;
  /** Names of the keys applied to process.env (never the values). */
  keys: string[];
}

/** Parse .env text into a key→value map. Skips comments, blank lines, and empty values. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = body.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === '') continue; // empty = "not set" (also avoids shadowing a later real value)
    out[key] = val;
  }
  return out;
}

/** Read + parse a .env file, or null if it doesn't exist. Does NOT touch process.env. */
export function readDotenvFile(file: string): Record<string, string> | null {
  try {
    return parseDotenv(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function loadDotenv(
  file: string = path.resolve(process.cwd(), '.env'),
  { override = false, exclude = [] }: { override?: boolean; exclude?: string[] } = {},
): LoadDotenvResult {
  const parsed = readDotenvFile(file);
  if (parsed === null) return { path: file, loaded: false, keys: [] };
  const keys: string[] = [];
  for (const [key, val] of Object.entries(parsed)) {
    if (exclude.includes(key) || (!override && process.env[key] !== undefined)) continue;
    process.env[key] = val;
    keys.push(key);
  }
  return { path: file, loaded: true, keys };
}
