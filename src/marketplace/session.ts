// A Marketplace session: resolve public OAuth once, then expose the manifest lifecycle
// operations bound to it. Commands depend on the `OpenSession` factory type so they can be tested
// with a fake session (no network).

import {
  getZoomAccessToken,
  marketplaceApiBase,
  validateAppManifest,
  getAppManifest,
  updateAppManifest,
  getApp,
  type ManifestValidationResult,
  type AppMetadata,
} from './client.js';
import type { ZoomEnv, ZoomCredentials } from '../config/env.js';
import type { ZoomManifest } from '../manifest/index.js';

export interface MarketplaceSession {
  validate(manifest: ZoomManifest, appId?: string): Promise<ManifestValidationResult>;
  getManifest(appId: string): Promise<ZoomManifest>;
  updateManifest(appId: string, manifest: ZoomManifest): Promise<{ status: number }>;
  /** Public app metadata (app_name, app_type…). Does NOT include the Bot JID (no API exposes it). */
  getApp(appId: string): Promise<AppMetadata>;
}

export type OpenSession = (args: { env: ZoomEnv; creds: ZoomCredentials }) => Promise<MarketplaceSession>;

export const openMarketplaceSession: OpenSession = async ({ env, creds }) => {
  const accessToken = await getZoomAccessToken({ zoomApiBase: env.zoomApiBase, ...creds });
  const zoomApiBase = marketplaceApiBase(env.zoomApiBase, creds);
  return {
    validate: (manifest, appId) => validateAppManifest({ zoomApiBase, accessToken, manifest, appId }),
    getManifest: (appId) => getAppManifest({ zoomApiBase, accessToken, appId }),
    updateManifest: (appId, manifest) => updateAppManifest({ zoomApiBase, accessToken, appId, manifest }),
    getApp: (appId) => getApp({ zoomApiBase, accessToken, appId }),
  };
};
