// Shared CLI configuration locations; generated app credentials are never loaded here.
import os from 'node:os';
import path from 'node:path';
import { readDotenvFile } from './dotenv.js';

export function managementCredCandidates(cliPackageRoot: string): string[] {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    process.env.ZOOM_AGENT_CONFIG,
    path.join(xdg, 'zoom-agent', '.env'),
    path.join(home, '.zoom-agent', '.env'),
    path.join(cliPackageRoot, '.env'),
  ].filter((p): p is string => !!p);
}

/** Load CLI-only tunnel configuration independently of Marketplace credentials. */
export function loadRootTunnelConfig(
  candidates: string[],
  read: (file: string) => Record<string, string> | null = readDotenvFile,
): string | null {
  if (process.env.NGROK_AUTHTOKEN?.trim()) return null;
  for (const file of candidates) {
    const token = read(file)?.NGROK_AUTHTOKEN?.trim();
    if (!token) continue;
    process.env.NGROK_AUTHTOKEN = token;
    return file;
  }
  return null;
}
