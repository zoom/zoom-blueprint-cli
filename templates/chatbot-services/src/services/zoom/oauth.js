// Zoom user OAuth flow helpers.
// Used by oauth-routes.js to redirect users through Zoom's authorization page
// and exchange the resulting auth code for access tokens.

import { ZOOM_OAUTH_BASE_URL } from '../../utils/constants.js';

/**
 * Build the Zoom OAuth authorization URL to redirect users to for login.
 * @param {{ clientId: string, redirectUri: string, state: string }}
 * @returns {string}
 */
export function buildOAuthAuthorizationUrl({ clientId, redirectUri, state }) {
  if (!clientId) throw new Error('Missing Zoom client ID');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri || process.env.ZOOM_REDIRECT_URI,
    state,
  });

  return `${ZOOM_OAUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
}

/**
 * Build an HTTP Basic authentication header from client credentials.
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {string} e.g. "Basic abc123..."
 */
function buildBasicAuthHeader(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('Missing Zoom client credentials');
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

/**
 * Exchange an OAuth authorization code for access and refresh tokens.
 * @param {{ code: string, redirectUri: string, clientId: string, clientSecret: string }}
 * @returns {Promise<{ access_token: string, refresh_token?: string, expires_in?: number }>}
 */
export async function exchangeCodeForAccessToken({ code, redirectUri, clientId, clientSecret }) {
  if (!code || !redirectUri) throw new Error('Missing code or redirectUri');

  const response = await fetch(`${ZOOM_OAUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error_description || error.error || response.statusText}`);
  }

  return response.json();
}
