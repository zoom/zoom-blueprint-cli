// Channel (in-channel app) support for Zoom Chat events.
//
// - team_chat.app_mention → the bot was @mentioned in a channel. The mention
//   message itself is the thread root, so replies thread underneath it. We strip
//   the mention token, detect intent, and route to the right flow.
// - chat_message.replied  → a user replied inside a channel thread. Used to
//   CONTINUE an active flow. The user JID is derived from operator_id (this event
//   has no operator_jid). Ignored when there is no active flow.
// - chat_message.sent     → a message posted in a channel. Retained for parity;
//   also only continues an active flow, ignores the bot's own messages, and is
//   de-duplicated against chat_message.replied by message_id.

import { handleTextMessage } from './action-router.js';
import * as ResearchHandler from './research-handler.js';
import * as AppreciationHandler from './appreciation-handler.js';
import { sendChatMessage } from '../services/zoom/chatbot-api.js';
import { buildServiceMenuCard } from '../services/zoom/cards/menu-cards.js';
import { getState } from '../utils/state-store.js';
import { getRedis } from '../utils/redis.js';
import { getXmppDomain, toChannelJid } from '../services/zoom/jid.js';
import { ACTIONS } from '../utils/constants.js';

// ─── Payload normalization ────────────────────────────────────────────────────

/**
 * Normalize a team_chat.app_mention payload. The mention's own message_id is the
 * thread root, so bot replies (and any buttons the user clicks) stay in one thread.
 * @param {Object} payload
 */
export function parseAppMentionPayload(payload) {
  const obj = payload?.object || {};
  return {
    operatorJid: deriveUserJid(payload),
    // Zoom Chat events give a bare channel_id/session_id — qualify it to a full JID.
    toJid: obj.to_jid || toChannelJid(obj.channel_id || obj.session_id) || payload?.toJid || null,
    text: obj.message || obj.text || '',
    atItems: obj.at_items || obj.atItems || [],
    displayName: obj.sender?.display_name || obj.display_name || 'User',
    // parent_msg_id is the thread root; obj.id is the mention's own message id.
    threadId: obj.parent_msg_id || obj.reply_main_message_id || obj.id || null,
  };
}

/**
 * Derive the acting user JID. chat_message.replied carries operator_id (a bare id),
 * not operator_jid, so reconstruct the JID from the bot's XMPP domain.
 * @param {Object} payload
 * @returns {string|null}
 */
function deriveUserJid(payload) {
  if (payload?.operator_jid) return payload.operator_jid;
  if (payload?.operator_id) return `${payload.operator_id.toLowerCase()}${getXmppDomain()}`;
  return payload?.userJid || payload?.object?.sender?.user_jid || payload?.object?.user_jid || null;
}

// ─── Mention parsing helpers ──────────────────────────────────────────────────

/**
 * Remove ALL bot-mention text from a channel message, so the user's actual input
 * remains (e.g. "@Zoom Service Chatbot Donte Small" → "Donte Small"). A single
 * @token strip is not enough because bot display names are often multi-word.
 *
 * Strategy, most reliable first:
 *   1. Explicit <@jid> tokens.
 *   2. Position spans from Zoom's at_items (start_position/end_position).
 *   3. The configured bot display name (ZOOM_BOT_NAME) — handles multi-word names.
 *   4. Fallback: a single leading @token.
 *
 * @param {string} text
 * @param {Array}  atItems - payload.object.at_items, when present
 * @returns {string}
 */
export function stripMentions(text = '', atItems = []) {
  let t = String(text);

  // 1. Explicit JID-format mentions.
  t = t.replace(/<@[^>]+>/g, ' ');

  // 2. Position-based spans (descending so earlier indices stay valid).
  const spans = (Array.isArray(atItems) ? atItems : [])
    .map((i) => ({
      start: i.start_position ?? i.startPosition ?? i.start,
      end: i.end_position ?? i.endPosition ?? i.end,
    }))
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end >= s.start)
    .sort((a, b) => b.start - a.start);
  for (const s of spans) t = t.slice(0, s.start) + t.slice(s.end + 1);

  // 3. Configured bot display name (case-insensitive, optional leading @).
  const botName = process.env.ZOOM_BOT_NAME;
  if (botName) {
    const esc = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`@?\\s*${esc}`, 'ig'), ' ');
  }

  // 4. Fallback: strip a single leading @token.
  t = t.replace(/^\s*@\S+\s*/, ' ');

  return t.replace(/\s+/g, ' ').trim();
}

/** Strip a leading "research:" / "appreciate:" command prefix to get the query. */
function extractQuery(text = '') {
  return text.replace(/^(?:research|appreciate|appreciation)\s*:\s*/i, '').trim();
}

/**
 * Classify a mention's intent. Explicit "command:" prefixes win over loose keywords.
 * @param {string} text
 * @returns {'RESEARCH'|'APPRECIATION'|'AMBIGUOUS'|'UNKNOWN'}
 */
export function detectMentionIntent(text) {
  const lower = (text || '').toLowerCase().trim();
  if (/^research:\s*/i.test(lower)) return 'RESEARCH';
  if (/^(?:appreciate|appreciation):\s*/i.test(lower)) return 'APPRECIATION';

  const hasResearch = ['research', 'ask', 'question', 'find', 'lookup', 'summarize', 'explain'].some(k => lower.includes(k));
  const hasAppreciation = ['appreciate', 'appreciation', 'recognize', 'thank', 'shoutout', 'kudos'].some(k => lower.includes(k));

  if (hasResearch && !hasAppreciation) return 'RESEARCH';
  if (hasAppreciation && !hasResearch) return 'APPRECIATION';
  if (hasResearch && hasAppreciation) return 'AMBIGUOUS';
  return 'UNKNOWN';
}

// ─── Routing ──────────────────────────────────────────────────────────────────

async function routeToResearch(toJid, userJid, text, threadId) {
  const query = extractQuery(text);
  if (query) {
    // A question was included → answer it directly, threaded under the mention.
    await ResearchHandler.handleResearchQuestion(toJid, userJid, query, threadId);
  } else {
    // No question → open the research sub-menu.
    await ResearchHandler.handleResearchAction(ACTIONS.START_RESEARCH, toJid, userJid, threadId);
  }
}

async function routeToAppreciation(toJid, userJid, _text, threadId) {
  await AppreciationHandler.startAppreciationFlow(toJid, userJid, threadId);
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * team_chat.app_mention — the bot was @mentioned in a channel.
 * @param {Object} payload
 */
export async function handleAppMention(payload) {
  const { toJid, operatorJid, text, atItems, threadId } = parseAppMentionPayload(payload);
  if (!toJid || !operatorJid) {
    console.warn('team_chat.app_mention: missing channel or operator JID, skipping');
    return;
  }

  // GUARD: if the user is already mid-flow, this mention is really a thread reply
  // that ALSO arrives as chat_message.replied/.sent. Let those continue the flow
  // so we don't double-process or capture the mention text as flow input.
  const state = await getState(operatorJid);
  if (state.step) {
    // Mid-flow: this mention also arrives as chat_message.replied/.sent, which
    // continue the flow. Skip here to avoid double-processing.
    return;
  }

  const cleanText = stripMentions(text, atItems);
  const intent = detectMentionIntent(cleanText);

  switch (intent) {
    case 'RESEARCH':
      await routeToResearch(toJid, operatorJid, cleanText, threadId);
      break;
    case 'APPRECIATION':
      await routeToAppreciation(toJid, operatorJid, cleanText, threadId);
      break;
    default: // AMBIGUOUS | UNKNOWN → show the menu so the user can pick
      await sendChatMessage(toJid, buildServiceMenuCard(), threadId, operatorJid);
  }
}

/**
 * chat_message.replied — a user replied in a channel thread. Continues an active flow.
 * @param {Object} payload
 */
export async function handleTeamChatMessageReply(payload) {
  const obj = payload?.object || {};
  await continueActiveFlow({
    toJid: obj.to_jid || toChannelJid(obj.channel_id || obj.session_id) || payload?.toJid || null,
    userJid: deriveUserJid(payload),
    message: obj.message || payload?.message || '',
    atItems: obj.at_items || obj.atItems || [],
    threadId: obj.parent_msg_id || obj.reply_main_message_id || obj.id || null,
    messageId: obj.id || obj.message_id || null,
    source: 'chat_message.replied',
  });
}

/**
 * chat_message.sent — a message posted in a channel. Continues an active flow.
 * @param {Object} payload
 */
export async function handleChannelMessage(payload) {
  const obj = payload?.object || {};
  await continueActiveFlow({
    toJid: obj.to_jid || toChannelJid(obj.channel_id || obj.session_id) || payload?.toJid || null,
    userJid: deriveUserJid(payload),
    message: obj.message || payload?.message || '',
    atItems: obj.at_items || obj.atItems || [],
    threadId: obj.parent_msg_id || obj.reply_main_message_id || obj.id || null,
    messageId: obj.id || obj.message_id || null,
    robotJid: obj.robot_jid || null,
    source: 'chat_message.sent',
  });
}

// ─── Shared continuation logic ────────────────────────────────────────────────

/**
 * Continue an active flow from a channel message. Ignores the bot's own messages
 * and ambient chatter (no active flow), and atomically de-duplicates a single
 * underlying message that may arrive as both chat_message.sent and .replied.
 */
async function continueActiveFlow({ toJid, userJid, message, atItems = [], threadId, messageId, robotJid, source }) {
  if (!toJid || !userJid) return;

  // Never react to the bot's own messages (prevents loops).
  const botJid = process.env.ZOOM_BOT_JID;
  if (botJid && (userJid === botJid || robotJid === botJid)) return;

  // Only continue a flow the user already started; ignore ambient chatter.
  const state = await getState(userJid);
  if (!state.step) return;

  // Strip the bot's @mention so the user's actual input is used as flow input
  // (e.g. "@Zoom Service Chatbot Donte Small" → "Donte Small").
  const cleaned = stripMentions(message, atItems);
  if (!cleaned) return; // message was only a mention with no content

  // Atomic claim so the same message isn't processed twice across event types.
  if (messageId && !(await claimMessage(messageId))) return;

  await handleTextMessage(toJid, userJid, cleaned, threadId);
}

/**
 * Atomically claim a message id for one-time processing (SET NX). Returns true if
 * this caller won the claim, false if it was already claimed.
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
async function claimMessage(messageId) {
  const result = await getRedis().set(`chanmsg:${messageId}`, 1, { nx: true, ex: 60 * 60 });
  return result !== null;
}
