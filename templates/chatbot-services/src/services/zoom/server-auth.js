// Chatbot OAuth: fetches a bot access token using the General App client credentials.
// This token is used by the bot to send messages on behalf of the Zoom app —
// no user interaction required.

import { ZOOM_OAUTH_BASE_URL } from '../../utils/constants.js';
import { getRedis } from '../../utils/redis.js';

const TOKEN_CACHE_KEY = 'zoom:s2s_token';
// Refresh a bit before Zoom's expiry to avoid using a token that dies mid-request.
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

/**
 * Delete the cached bot token so the next call fetches a fresh one. Call this when
 * Zoom rejects the token (e.g. after a credential rotation) to self-heal the cache.
 * @returns {Promise<void>}
 */
export async function invalidateChatbotToken() {
  await getRedis().del(TOKEN_CACHE_KEY);
}

/**
 * Get a Zoom bot access token using the chatbot client_credentials grant (separate from CLI PKCE).
 * The token is cached in Redis until shortly before it expires — Zoom rate-limits token
 * generation, so we must not request a new one on every outbound message.
 * @param {{ forceRefresh?: boolean }} [options] - skip the cache and fetch a new token
 * @returns {Promise<string>} Access token
 */
export async function getChatbotToken({ forceRefresh = false } = {}) {
  const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

  if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Missing required environment variables: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET');
  }

  const redis = getRedis();

  if (!forceRefresh) {
    const cached = await redis.get(TOKEN_CACHE_KEY);
    if (cached?.access_token) return cached.access_token;
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${ZOOM_OAUTH_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to get Zoom bot token: ${error.error_description || error.error || response.statusText}`);
  }

  const data = await response.json();

  // Cache until just before expiry (Zoom tokens are typically valid for 1 hour).
  const ttl = Math.max((data.expires_in ?? 3600) - TOKEN_EXPIRY_SKEW_SECONDS, TOKEN_EXPIRY_SKEW_SECONDS);
  await redis.set(TOKEN_CACHE_KEY, { access_token: data.access_token }, { ex: ttl });

  return data.access_token;
}
