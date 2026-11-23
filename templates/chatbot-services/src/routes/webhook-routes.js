import express from 'express';
import crypto from 'crypto';
import { verifyZoomWebhookSignature, validateWebhookPayload, createValidationMiddleware } from '../services/zoom/webhook-validation.js';
import { sendChatMessage } from '../services/zoom/chatbot-api.js';
import { buildServiceMenuCard, buildChannelWelcomeCard } from '../services/zoom/cards/menu-cards.js';
import { handleChatMessageSubmit }   from '../handlers/submit-handler.js';
import { handleBotAction, handleTextMessage } from '../handlers/action-router.js';
import { handleAppMention, handleChannelMessage, handleTeamChatMessageReply } from '../handlers/channel-handler.js';
import { getRedis } from '../utils/redis.js';

const router = express.Router();

// Idempotency: Zoom retries deliveries on non-2xx/timeout and can occasionally
// double-deliver. Each distinct event carries its own timestamp/ids, so a retried
// delivery hashes identically while genuinely distinct events do not. We record
// the fingerprint in Redis (SET NX) and skip anything we've already processed.
const IDEMPOTENCY_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Returns true if this exact event body has already been seen within the TTL.
 * @param {Object} rawBody - the full webhook request body
 * @returns {Promise<boolean>}
 */
async function isDuplicateEvent(rawBody) {
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rawBody)).digest('hex');
  // SET NX returns 'OK' when the key is newly set, null when it already existed.
  const result = await getRedis().set(`idempotency:${fingerprint}`, 1, {
    nx: true,
    ex: IDEMPOTENCY_TTL_SECONDS,
  });
  return result === null;
}

/**
 * Handles Zoom Chat webhook events
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleZoomWebhook(req, res) {
  const { event, payload } = req.body;

  // The URL validation challenge is special: Zoom may deliver it without signature
  // headers, and it must always be answered. We STILL verify the signature when the
  // headers ARE present (Zoom signs these), and only skip verification when the headers
  // are entirely absent AND this is a url_validation event. Signature verification is
  // never skipped for any other event type.
  const isUrlValidation = event === 'endpoint.url_validation';
  const hasSignatureHeaders =
    !!req.headers['x-zm-signature'] && !!req.headers['x-zm-request-timestamp'];

  // 1. Verify webhook signature. Failures are answered synchronously with 401.
  if (!isUrlValidation || hasSignatureHeaders) {
    try {
      verifyZoomWebhookSignature(req);
    } catch (error) {
      console.error('Webhook signature verification failed:', error.message);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
      });
    }
  }

  console.log(`Received Zoom webhook event: ${event}`);

  // 2. The URL validation challenge must be answered synchronously in the response body.
  // Zoom expects BOTH the plainToken it sent and an encryptedToken = HMAC-SHA256(plainToken)
  // keyed with the app's verification (secret) token.
  if (isUrlValidation) {
    console.log('Validating webhook endpoint URL');
    const plainToken = payload?.plainToken || '';
    const encryptedToken = crypto
      .createHmac('sha256', process.env.ZOOM_VERIFICATION_TOKEN)
      .update(plainToken)
      .digest('hex');

    return res.status(200).json({ plainToken, encryptedToken });
  }

  // 3. Acknowledge every other event immediately (within Zoom's 3s window), THEN do the
  // potentially slow work (Claude API calls, outbound messages) asynchronously. The
  // response has already been sent, so downstream errors are logged, not returned.
  res.status(200).json({ success: true, message: 'Event received', event });

  processWebhookEvent(event, payload, req.body).catch(error => {
    console.error(`Error processing Zoom webhook event "${event}":`, error);
  });
}

/**
 * Processes a verified webhook event after the 200 acknowledgement has been sent.
 * @param {string} event - Zoom event type
 * @param {Object} payload - Zoom event payload
 * @param {Object} rawBody - full request body, used for idempotency fingerprinting
 */
async function processWebhookEvent(event, payload, rawBody) {
  // Skip events we've already processed (Zoom retries / double-deliveries).
  if (await isDuplicateEvent(rawBody)) {
    console.log(`Skipping duplicate webhook event "${event}"`);
    return;
  }

  const toJid   = payload?.toJid;
  const message = payload?.cmd || payload?.message || '';
  const userId  = payload?.userJid;

  switch (event) {
    case 'bot_installed':
      await sendChatMessage(toJid, buildServiceMenuCard(), null, userId);
      break;

    case 'bot_notification': {
      // replyMainMessageId is the thread root — only present when the user is inside a thread.
      // messageId is the user's own message and is NOT a valid thread root to reply under.
      const threadId = payload?.replyMainMessageId || null;
      await handleTextMessage(toJid, userId, message, threadId);
      break;
    }

    case 'interactive_message_actions': {
      const threadId = payload?.replyMainMessageId || null;
      await handleBotAction(payload?.actionItem?.value || '', toJid, userId, payload, threadId);
      break;
    }

    case 'chat_message.submit':
      // For submit events, user_jid lives inside payload.object
      await handleChatMessageSubmit(payload);
      break;

    case 'team_chat.app_invited': {
      const channelJid  = payload?.object?.to_jid;
      const channelName = payload?.object?.channel_name || 'this channel';
      const inviterJid  = payload?.object?.user_jid;
      await sendChatMessage(channelJid, buildChannelWelcomeCard(channelName), null, inviterJid);
      break;
    }

    case 'team_chat.app_mention':
      await handleAppMention(payload);
      break;

    case 'chat_message.replied':
      // A user replied inside a channel thread — continue an active flow.
      await handleTeamChatMessageReply(payload);
      break;

    case 'chat_message.sent':
      // A message was posted in a channel the bot is in. The handler only acts on
      // it to continue an active flow and ignores the bot's own messages.
      await handleChannelMessage(payload);
      break;

    case 'app_deauthorized':
      break;

    default:
      console.log(`Unsupported Zoom webhook event type: ${event}`);
      break;
  }
}

// Webhook route with validation
router.post('/', createValidationMiddleware(validateWebhookPayload), handleZoomWebhook);

// Health check endpoint
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'zoom-webhook-handler',
  });
});

export default router;
