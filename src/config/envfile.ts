// Read and update project .env files while preserving comments and key order.
// Preserves comments/order; updates a key in place or appends it. Writes 0600 (owner-only) because
// the file can hold API keys and a created app's secret.

import fs from 'node:fs/promises';
import path from 'node:path';

export async function readEnvFile(envPath: string): Promise<string | null> {
  try {
    return await fs.readFile(envPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Update `key=value` in the .env contents, preserving comments/order. Appends if absent. */
export function upsertEnvLine(contents: string, key: string, value: string): string {
  const safeValue = /[\s#"']/.test(value) ? JSON.stringify(value) : value;
  const lines = (contents || '').split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  let found = false;
  const out = lines.map((line) => {
    if (re.test(line) && !line.trimStart().startsWith('#')) {
      found = true;
      return `${key}=${safeValue}`;
    }
    return line;
  });
  if (!found) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    out.push(`${key}=${safeValue}`);
  }
  if (out[out.length - 1] !== '') out.push('');
  return out.join('\n');
}

export async function writeEnvVar(
  envPath: string,
  key: string,
  value: string,
): Promise<{ path: string; created: boolean }> {
  return writeEnvVars(envPath, [{ key, value }]);
}

/**
 * Apply several key=value upserts in one read-modify-write, preserving comments/order and
 * writing 0600. A batch needs only one write, but the write is not crash-atomic.
 * An empty entries list is a no-op that still reports whether the file exists.
 */
export async function writeEnvVars(
  envPath: string,
  entries: Array<{ key: string; value: string }>,
): Promise<{ path: string; created: boolean }> {
  const dir = path.dirname(envPath);
  await fs.mkdir(dir, { recursive: true });
  const current = await readEnvFile(envPath);
  if (entries.length === 0) return { path: envPath, created: current === null };
  let next = current || '';
  for (const { key, value } of entries) next = upsertEnvLine(next, key, value);
  await fs.writeFile(envPath, next, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(envPath, 0o600);
  } catch {
    /* best-effort; non-POSIX filesystems may not support chmod */
  }
  return { path: envPath, created: current === null };
}

/** Read a single key's value from .env contents (unquoted). Returns undefined if absent/commented. */
export function readEnvValue(contents: string | null, key: string): string | undefined {
  if (!contents) return undefined;
  const re = new RegExp(`^\\s*${key}\\s*=(.*)$`);
  for (const line of contents.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(re);
    if (m) return unquote(m[1].trim());
  }
  return undefined;
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    try {
      return v.startsWith('"') ? JSON.parse(v) : v.slice(1, -1);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}
