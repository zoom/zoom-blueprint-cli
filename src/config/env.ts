import { hasSession } from '../auth/store.js';
// Marketplace environment selection and management credential resolution.

export interface ZoomEnv {
  name: string;
  marketplaceUrl: string;
  zoomApiBase: string;
}

const ENVIRONMENTS: Record<string, Omit<ZoomEnv, 'name'>> = {
  prod: { marketplaceUrl: 'https://marketplace.zoom.us', zoomApiBase: 'https://zoom.us' },
};

export const VALID_ENVS = Object.keys(ENVIRONMENTS);

/** Resolve the active environment. Defaults to prod (the real Marketplace); override with ENV. */
export function getEnv(name = process.env.ZOOM_ENV || process.env.ENV || 'prod'): ZoomEnv {
  const key = String(name).toLowerCase();
  if (!ENVIRONMENTS[key]) {
    throw new Error(`Unknown environment "${name}". Use one of: ${VALID_ENVS.join(', ')}`);
  }
  return { name: key, ...ENVIRONMENTS[key] };
}

/** Link to the app editor in the selected Marketplace environment. */
export function marketplaceAppUrl(env: ZoomEnv, appId: string, page?: 'surface' | 'access'): string {
  const appUrl = `${env.marketplaceUrl}/develop/applications/${encodeURIComponent(appId)}`;
  return page ? `${appUrl}/features/${page}?mode=dev` : `${appUrl}/information`;
}

export interface ZoomCredentials {
  /** Resolve the saved public-client OAuth session; never put tokens in project env. */
  publicOAuth?: boolean;
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ZoomCredentialsResult {
  ok: boolean;
  creds: ZoomCredentials;
  missing: string[];
}

/** Marketplace management uses only the saved public-client OAuth session. */
export function getZoomCredentials(_env: NodeJS.ProcessEnv = process.env): ZoomCredentialsResult {
  return hasSession()
    ? { ok: true, creds: { publicOAuth: true }, missing: [] }
    : { ok: false, creds: {}, missing: ['Zoom login (run zoom login)'] };
}
