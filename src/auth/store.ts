import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OAuthSession {
  version: 1;
  environment: 'prod' | 'dev';
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export function authDirectory(): string {
  return process.env.ZOOM_AUTH_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zoom-agent', 'auth');
}

export function sessionPath(environment: string): string {
  if (!['prod', 'dev'].includes(environment)) throw new Error('Unknown OAuth environment.');
  return path.join(authDirectory(), `${environment}.json`);
}

export function readSession(environment: string): OAuthSession | undefined {
  let text: string;
  try { text = fs.readFileSync(sessionPath(environment), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read Zoom login. Check permissions on the CLI auth directory.');
  }
  try {
    const s = JSON.parse(text) as OAuthSession;
    if (s.version !== 1 || s.environment !== environment || typeof s.clientId !== 'string' || !s.clientId || typeof s.accessToken !== 'string' || !s.accessToken || typeof s.refreshToken !== 'string' || !s.refreshToken ||
        !Number.isFinite(s.expiresAt) || !Array.isArray(s.scopes) || !s.scopes.every(v => typeof v === 'string')) throw new Error();
    return s;
  } catch { throw new Error('Saved Zoom login is invalid. Run zoom logout, then zoom login again.'); }
}

export function hasSession(): boolean {
  return ['prod', 'dev'].some(environment => !!readSession(environment));
}

/** Replace tokens atomically so rotating refresh tokens are never partially written. */
export async function saveSession(session: OAuthSession): Promise<void> {
  const destination = sessionPath(session.environment);
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporary, JSON.stringify(session) + '\n', { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, destination);
  } finally { await fsp.rm(temporary, { force: true }); }
}

export async function removeSession(environment: string): Promise<void> {
  await fsp.rm(sessionPath(environment), { force: true });
}

/** Serialize refresh/logout across CLI processes so a rotating token is consumed only once. */
export async function withSessionLock<T>(environment: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${sessionPath(environment)}.lock`;
  await fsp.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 25000;
  for (;;) {
    let handle;
    try { handle = await fsp.open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number(await fsp.readFile(lockPath, 'utf8'));
        if (Number.isInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { await fsp.rm(lockPath, { force: true }); continue; } }
        }
      } catch (readError) { if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue; }
      if (Date.now() >= deadline) throw new Error('Another Zoom login operation is still running. Wait for it to finish, then retry.');
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    try { await handle.writeFile(String(process.pid)); return await action(); }
    finally { await handle.close(); await fsp.rm(lockPath, { force: true }); }
  }
}
