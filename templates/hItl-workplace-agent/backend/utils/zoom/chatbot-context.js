// Per-event routing stays isolated across concurrent, signature-verified webhooks.
import { AsyncLocalStorage } from 'node:async_hooks';
const events = new AsyncLocalStorage();

export function withChatbotEvent(payload, handler) {
  return events.run({
    accountId: payload?.accountId || payload?.account_id,
    robotJid: payload?.robotJid || payload?.robot_jid,
    userJid: payload?.userJid || payload?.object?.user_jid,
  }, handler);
}

export function chatbotIdentity() {
  const event = events.getStore() || {};
  const accountId = event.accountId || process.env.ZOOM_ACCOUNT_ID;
  const robotJid = event.robotJid || process.env.ZOOM_BOT_JID;
  if (!accountId || /^(your[_-]|placeholder)/i.test(accountId)) {
    throw new Error('Cannot send a chatbot reply: no valid account ID. Replies need accountId from a verified Zoom webhook; standalone sends need ZOOM_ACCOUNT_ID in .env.');
  }
  if (!robotJid || /^(your[_-]|placeholder)/i.test(robotJid)) {
    throw new Error('Cannot send a chatbot reply: no Bot JID. Set ZOOM_BOT_JID from Marketplace Features → Surface.');
  }
  return { accountId, robotJid, userJid: event.userJid };
}
