// Redis-backed state layer (Upstash).
//
//  Every key carries a TTL, so abandoned flows expire automatically.\
// All functions are async — callers must await them.
//
// @upstash/redis serializes objects to JSON on write and parses them on read,
// so every value stored here is an object.

import { getRedis } from './redis.js';

// TTLs (seconds). Flow state is short-lived; conversation history lives longer.
const STATE_TTL_SECONDS   = 60 * 30;      // 30 minutes
const HISTORY_TTL_SECONDS = 60 * 60 * 2;  // 2 hours
const MAX_HISTORY_TURNS   = 20;

const DEFAULT_STATE = {
  service: null,
  step: null,
  recipientName: null,
  recipientEmail: null,
  threadId: null,        // replyMainMessageId from the event that started this flow
  threadMessageId: null, // message_id of the bot's own prompt (research fallback)
};

const stateKey   = (userJid) => `state:${userJid}`;
const historyKey = (toJid) => `history:${toJid}`;

/**
 * Get the current flow state for a user, merged over the default shape.
 * @param {string} userJid
 * @returns {Promise<Object>}
 */
export async function getState(userJid) {
  const stored = await getRedis().get(stateKey(userJid));
  return stored ? { ...DEFAULT_STATE, ...stored } : { ...DEFAULT_STATE };
}

/**
 * Merge updates into a user's flow state and refresh its TTL.
 * @param {string} userJid
 * @param {Object} updates
 * @returns {Promise<Object>} the new state
 */
export async function setState(userJid, updates) {
  const next = { ...(await getState(userJid)), ...updates };
  await getRedis().set(stateKey(userJid), next, { ex: STATE_TTL_SECONDS });
  return next;
}

/**
 * Clear a user's flow state.
 * @param {string} userJid
 * @returns {Promise<void>}
 */
export async function clearState(userJid) {
  await getRedis().del(stateKey(userJid));
}

/**
 * Get the stored Claude conversation history for a destination.
 * @param {string} toJid
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function getConversationHistory(toJid) {
  return (await getRedis().get(historyKey(toJid))) ?? [];
}

/**
 * Append turns to the conversation history, trim to the most recent
 * MAX_HISTORY_TURNS, and refresh the TTL.
 * @param {string} toJid
 * @param {Array<{role: string, content: string}>} turns
 * @returns {Promise<Array>} the trimmed history
 */
export async function appendConversationTurns(toJid, turns) {
  const history = await getConversationHistory(toJid);
  const next = [...history, ...turns];
  const trimmed = next.length > MAX_HISTORY_TURNS ? next.slice(-MAX_HISTORY_TURNS) : next;
  await getRedis().set(historyKey(toJid), trimmed, { ex: HISTORY_TTL_SECONDS });
  return trimmed;
}
