/**
 * Validation utilities for Zoom Chat webhook payloads and API requests
 */

import crypto from 'crypto';

// Reject webhook events whose timestamp is outside this window (seconds) to
// prevent replay of a previously-captured, validly-signed request.
const WEBHOOK_REPLAY_WINDOW_SECONDS = 5 * 60;

/**
 * Constant-time comparison of two strings. Avoids leaking how many leading
 * bytes matched via early-exit timing. Returns false on any length mismatch.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify Zoom webhook signature to ensure authenticity
 * @param {Object} req - Express request object
 * @throws {Error} If signature verification fails
 */
export function verifyZoomWebhookSignature(req) {
  const signature = req.headers['x-zm-signature'];
  const timestamp = req.headers['x-zm-request-timestamp'];

  if (!signature || !timestamp) {
    throw new Error('Missing signature headers');
  }

  // Reject stale/future timestamps before doing any HMAC work (replay protection).
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new Error('Invalid webhook timestamp');
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_REPLAY_WINDOW_SECONDS) {
    throw new Error('Stale webhook timestamp');
  }

  // Zoom signs the RAW request bytes. Re-serializing the parsed body (JSON.stringify)
  // can differ from what Zoom sent (key order, whitespace, unicode escaping) and cause
  // silent 401s, so prefer the captured raw body and only fall back when it is absent.
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const message = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', process.env.ZOOM_VERIFICATION_TOKEN)
    .update(message)
    .digest('hex');

  const expectedSignature = `v0=${hash}`;

  if (!timingSafeEqualStr(signature, expectedSignature)) {
    throw new Error('Invalid webhook signature');
  }
}

/**
 * Validate Zoom webhook payload structure
 * @param {Object} payload - Webhook payload
 * @returns {Object} Validation result
 */
export function validateWebhookPayload(payload) {
  const errors = [];

  if (!payload) {
    return { isValid: false, errors: ['Payload is required'] };
  }

  if (!payload.event) {
    errors.push('Event type is required');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate message request payload
 * @param {Object} payload - Message request payload
 * @returns {Object} Validation result
 */
export function validateMessagePayload(payload) {
  const errors = [];

  if (!payload) {
    return { isValid: false, errors: ['Payload is required'] };
  }

  if (!payload.to_jid || typeof payload.to_jid !== 'string') {
    errors.push('to_jid is required and must be a string');
  }

  if (!payload.message || typeof payload.message !== 'string') {
    errors.push('message is required and must be a string');
  }

  if (payload.message && payload.message.length > 4096) {
    errors.push('message must be 4096 characters or less');
  }

  if (payload.reply_to && typeof payload.reply_to !== 'string') {
    errors.push('reply_to must be a string if provided');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Patterns that indicate a value is still a copied-from-.env.example placeholder
// rather than a real configured value. Treated as "not set" so setup mistakes fail
// loudly at boot instead of silently at runtime.
const PLACEHOLDER_PATTERNS = [
  /your_.*_here/i,
  /your[-_]tunnel[-_]url/i,
  /your-db-name\.upstash\.io/i,
  /^change-this/i,
];

/**
 * Returns true if a value is empty or matches a known placeholder pattern
 * (and should therefore be treated as NOT configured).
 * @param {string|undefined|null} value
 * @returns {boolean}
 */
export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  const str = String(value).trim();
  if (str === '') return true;
  if (str.includes('{{') && str.includes('}}')) return true;
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(str));
}

/**
 * Validate required environment variables
 * @returns {Object} Validation result
 */
export function validateEnvironmentVariables() {
  // NOTE: UPSTASH_REDIS_REST_URL/TOKEN are intentionally NOT required here — when
  // they are absent the app falls back to an in-memory store for local dev (see
  // utils/redis.js). They are still documented in .env.example for production.
  const required = [
    'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET',
    'ZOOM_BOT_JID',
    'ZOOM_VERIFICATION_TOKEN'
  ];

  if (process.env.NODE_ENV === 'production') required.push('ANTHROPIC_API_KEY');

  // A value that is empty OR still a placeholder counts as unset.
  const missing = required.filter(variable => {
    const value = process.env[variable];
    if (variable === 'ANTHROPIC_API_KEY') {
      return !value?.startsWith('sk-ant-') || /\s|\.\.\.|\{\{/.test(value);
    }
    return isPlaceholder(value);
  });

  const errors = missing.length
    ? [
        `Unset or placeholder environment variable(s): ${missing.join(', ')}`,
        'Hint: run `zoom configure` to set these values (see .env.example).',
      ]
    : [];

  return {
    isValid: missing.length === 0,
    missing,
    errors
  };
}

/**
 * Sanitize message content to prevent potential issues
 * @param {string} message - Message content
 * @returns {string} Sanitized message
 */
export function sanitizeMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }

  // Basic sanitization - remove/escape potentially problematic characters
  return message
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 4096); // Ensure message length limit
}

/**
 * Create validation middleware for Express routes
 * @param {Function} validator - Validation function
 * @returns {Function} Express middleware
 */
export function createValidationMiddleware(validator) {
  return (req, res, next) => {
    const validation = validator(req.body);
    
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors
      });
    }

    next();
  };
}