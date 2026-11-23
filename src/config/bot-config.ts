// Legacy extraction helpers retained for compatibility. The CLI's active setup uses
// validated, developer-supplied Marketplace values through config/reconcile.ts.
// These helpers do not automatically configure a running sample. Never bootstrap a trusted
// webhook signing secret from an unauthenticated webhook body.

import { validateBotJid, validateSecretToken } from './reconcile.js';

export interface BotConfigResult {
  botJid?: string;
  verificationToken?: string;
  source: 'api' | 'manual' | 'webhook' | 'unavailable';
  message?: string;
}

/**
 * Attempt to retrieve Bot JID and verification token from Zoom Marketplace APIs.
 *
 * **Current Reality**: These values are NOT exposed by any documented Zoom API.
 * This function exists to:
 * 1. Document the limitation clearly
 * 2. Provide a hook for future API enhancements
 * 3. Centralize the retrieval logic
 *
 * @returns Result with source='unavailable' and guidance for manual retrieval
 */
export async function retrieveBotConfiguration(_args: {
  appId: string;
  getManifest?: (appId: string) => Promise<any>;
}): Promise<BotConfigResult> {
  return {
    source: 'unavailable',
    message: 'Bot JID and verification token are not exposed by Zoom Marketplace APIs',
  };
}

/** Inspect legacy payload fields; callers must establish authenticity independently. */
export function extractBotConfigFromWebhook(webhookPayload: any): BotConfigResult | null {
  if (!webhookPayload || typeof webhookPayload !== 'object') return null;

  let botJid: string | undefined;
  let verificationToken: string | undefined;

  // Extract Bot JID from payload.toJid
  if (webhookPayload.payload?.toJid && typeof webhookPayload.payload.toJid === 'string') {
    const jid = webhookPayload.payload.toJid;
    if (!validateBotJid(jid)) {
      botJid = jid;
    }
  }

  // Extract verification token from root
  if (webhookPayload.verification_token && typeof webhookPayload.verification_token === 'string') {
    const token = webhookPayload.verification_token;
    if (!validateSecretToken(token)) {
      verificationToken = token;
    }
  }

  if (!botJid && !verificationToken) return null;

  return {
    botJid,
    verificationToken,
    source: 'webhook',
    message: 'Extracted from webhook payload',
  };
}
