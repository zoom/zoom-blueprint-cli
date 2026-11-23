import { sendChatMessage, buildTextContent } from '../services/zoom/chatbot-api.js';
import { getState, clearState } from '../utils/state-store.js';
import { buildConfirmationCard } from '../services/zoom/cards/appreciation-cards.js';
import { toChannelJid } from '../services/zoom/jid.js';

/**
 * Normalize submit_items from a chat_message.submit payload into a flat
 * { action_id: value } map. Handles several shapes Zoom may use.
 * @param {Array} submitItems
 * @returns {{ [action_id: string]: string }}
 */
function normalizeSubmitItems(submitItems = []) {
  return submitItems.reduce((acc, item) => {
    // Zoom wraps each submitted field in a type key:
    // { plain_text_input: { action_id, value, text } }
    if (item.plain_text_input) {
      const { action_id, value } = item.plain_text_input;
      if (action_id) acc[action_id] = value ?? '';
      return acc;
    }

    // Button item — no field value, skip
    if (item.actionItem) return acc;

    // Fallback: flat { action_id, value } shape
    const actionId =
      item.action_id ||
      item.actionId  ||
      item.id        ||
      item.name;

    const value =
      item.value                   ??
      item.text                    ??
      item?.input?.value           ??
      item?.selected_option?.value ??
      item?.selected_value;

    if (actionId && value !== undefined) acc[actionId] = value;
    return acc;
  }, {});
}

/**
 * Handle chat_message.submit events fired when the user clicks a Submit button
 * on a card form (`settings.form: true`, `submit: true` on the action item).
 * Sends the confirmation card directly with colored markdown fields.
 * @param {Object} payload - raw Zoom webhook payload (req.body.payload)
 */
export async function handleChatMessageSubmit(payload) {
  const object  = payload?.object;
  const userJid = object?.user_jid;
  // Qualify a bare channel_id/session_id to a full JID (channel submits otherwise
  // send to a non-existent DM JID and vanish).
  const toJid   = toChannelJid(object?.to_jid || object?.channel_id || object?.session_id);

  try {
    // Submitted field values come directly from the card form's submit_items.
    const fields = normalizeSubmitItems(object?.submit_items || []);

    const REQUIRED = ['what_was_done', 'why_it_mattered', 'who_it_helped'];
    const missing  = REQUIRED.filter(k => !fields[k]?.trim());

    // Retrieve recipient info and thread context from session state early
    // so threadId is available for both the error path and the success path.
    const state = await getState(userJid);
    const recipient = state.recipientEmail || state.recipientName || 'N/A';
    const threadId = state.threadId || null;

    if (missing.length > 0) {
      await sendChatMessage(toJid, buildTextContent('Please complete all required fields before submitting.'), threadId, userJid);
      return;
    }

    await clearState(userJid);
    await sendChatMessage(toJid, buildConfirmationCard(recipient, fields), threadId, userJid);
  } catch (error) {
    console.error('handleChatMessageSubmit error:', error);
    const threadId = (await getState(userJid))?.threadId || null;
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId, userJid);
  }
}
