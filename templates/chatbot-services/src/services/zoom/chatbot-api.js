import { getChatbotToken, invalidateChatbotToken } from './server-auth.js';
import { ZOOM_API_BASE_URL } from '../../utils/constants.js';

/**
 * Build a plain-text message content object for the Zoom chatbot API.
 * @param {string} text
 * @returns {Object}
 */
export function buildTextContent(text) {
  return {
    head: { text: 'Chatbot' },
    body: [{ type: 'message', text }],
  };
}

/**
 * Send a message to a Zoom Chat user or channel.
 * @param {string} toJid       - Recipient JID (user or channel)
 * @param {Object} content     - Zoom card content object (head/body or settings/body)
 * @param {string|null} replyTo  - Optional message ID to thread the reply under
 * @param {string|null} userJid  - Acting user JID. Defaults to toJid (correct for DMs).
 *                                 For channel messages, pass the inviting user's JID.
 * @param {Object} [options]      - { visibleToUser?: string, markdown?: boolean }
 *                                  visibleToUser restricts a channel message to one user;
 *                                  markdown enables Zoom markdown rendering for the message text.
 * @returns {Promise<Object>} Zoom API response (includes message_id)
 */
export async function sendChatMessage(toJid, content, replyTo = null, userJid = null, options = {}) {
  const body = {
    account_id: process.env.ZOOM_ACCOUNT_ID || '',
    content,
    robot_jid: process.env.ZOOM_BOT_JID || '',
    to_jid: toJid,
    user_jid: userJid || toJid,
  };

  // Zoom chatbot API threads replies using "reply_to", not "reply_main_message_id".
  // Omit the key entirely when not threading — do not send null/"null".
  if (replyTo) body.reply_to = replyTo;
  // Restrict channel visibility to one user when requested ("only-me").
  if (options.visibleToUser) body.visible_to_user = options.visibleToUser;
  // Enable Zoom markdown rendering. This flag belongs at the ROOT of the send body
  // (not on the content item). Zoom renders **bold**, _italic_, ~strike~, `code`,
  // > blockquote, and <url> links; headers/lists/code-fences are not supported.
  if (options.markdown) body.is_markdown_support = true;

  // First attempt with the (possibly cached) token; if Zoom rejects it with 401,
  // invalidate the cache, mint a fresh token, and retry once.
  let response = await postChatMessage(body, await getChatbotToken());

  if (response.status === 401) {
    console.warn('Zoom rejected the bot token (401). Refreshing and retrying once.');
    await invalidateChatbotToken();
    response = await postChatMessage(body, await getChatbotToken({ forceRefresh: true }));
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to send message: ${error.message || response.statusText}`);
  }

  return response.json();
}

/**
 * POST a message body to the Zoom chatbot API with the given bearer token.
 * @param {Object} body - request body
 * @param {string} accessToken - Zoom bot access token
 * @returns {Promise<Response>} the raw fetch Response (caller inspects status)
 */
function postChatMessage(body, accessToken) {
  return fetch(`${ZOOM_API_BASE_URL}/im/chat/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Edit an existing chatbot message in place (PUT /im/chat/messages/:messageId).
 * The edit inherits the original message's thread position, so no reply_to is sent.
 * Used for the "send a placeholder, then swap in the final answer" pattern.
 * @param {string} messageId - ID returned by the original sendChatMessage
 * @param {string} toJid     - Recipient JID (channel or user) — must match the original
 * @param {string} userJid   - Acting user JID
 * @param {Object} content    - New Zoom card content object
 * @param {Object} [options]  - { markdown?: boolean }
 * @returns {Promise<Object>} Zoom API response
 */
export async function editChatbotMessage(messageId, toJid, userJid, content, options = {}) {
  const body = {
    robot_jid: process.env.ZOOM_BOT_JID || '',
    account_id: process.env.ZOOM_ACCOUNT_ID || '',
    to_jid: toJid,
    user_jid: userJid || toJid,
    content,
  };
  if (options.markdown) body.is_markdown_support = true;

  const put = (accessToken) =>
    fetch(`${ZOOM_API_BASE_URL}/im/chat/messages/${messageId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  // Same 401 self-heal as sendChatMessage.
  let response = await put(await getChatbotToken());
  if (response.status === 401) {
    console.warn('Zoom rejected the bot token (401) on edit. Refreshing and retrying once.');
    await invalidateChatbotToken();
    response = await put(await getChatbotToken({ forceRefresh: true }));
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to edit message: ${error.message || response.statusText}`);
  }

  // Edit responses can be empty — tolerate a missing/blank body.
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

