// Recovery records retain the app ID after remote creation; they never contain app secrets.
//
// A record is started before creation and completed after the API returns. An interruption
// between those operations can leave an ambiguous creating record.

import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_DIR_NAME = '.zoom-agent-state';

const recoveryDir = (cwd = process.cwd()): string => path.resolve(cwd, STATE_DIR_NAME);
const recoveryPath = (id: string, cwd = process.cwd()): string =>
  path.join(recoveryDir(cwd), `app-${sanitize(id)}.json`);

function sanitize(id: string): string {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export interface RecoveryRecord {
  id?: string;
  alias?: string;
  [key: string]: unknown;
}

export async function writeRecovery(record: RecoveryRecord, cwd = process.cwd()): Promise<string> {
  await fs.mkdir(recoveryDir(cwd), { recursive: true });
  const p = recoveryPath(String(record.id || record.alias || 'unknown'), cwd);
  await fs.writeFile(p, JSON.stringify(record, null, 2), 'utf8');
  return p;
}

export async function updateRecovery(
  id: string,
  patch: Record<string, unknown>,
  cwd = process.cwd(),
): Promise<string> {
  const p = recoveryPath(id, cwd);
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    current = { id };
  }
  const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeFile(p, JSON.stringify(merged, null, 2), 'utf8');
  return p;
}
