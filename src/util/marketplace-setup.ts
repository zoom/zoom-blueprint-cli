import { randomBytes } from 'node:crypto';
import { marketplaceAppUrl, type ZoomEnv } from '../config/env.js';
import { log, renderMarketplaceHelp } from './logger.js';

/** Short project label plus a random suffix avoids the shared sample command namespace. */
export function projectSlashCommand(projectName: string): string {
  const label = projectName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'zoomapp';
  return `${label}${randomBytes(4).toString('hex')}`;
}

export function printMarketplaceSetup(env: ZoomEnv, appId: string): void {
  log.plain(renderMarketplaceHelp('Open Marketplace app\n    ' + marketplaceAppUrl(env, appId)));
  log.plain();
  log.plain('  Run zoom dev to start local development and finish Zoom setup.');
}
