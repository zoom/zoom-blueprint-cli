// Zoom identifies conversations with XMPP-style JIDs. Channel JIDs contain
// "@conference."; direct-message JIDs do not.
//
//   Channel JID: abc123@conference.xmpp.zoom.us
//   DM JID:      user123@xmpp.zoom.us

/**
 * The XMPP domain of the bot, e.g. "@xmpp.zoom.us", derived from ZOOM_BOT_JID.
 * Used to reconstruct a user JID from a bare operator_id.
 * @returns {string}
 */
export function getXmppDomain() {
  const botJid = process.env.ZOOM_BOT_JID || '';
  const at = botJid.indexOf('@');
  return at >= 0 ? botJid.substring(at) : '@xmpp.zoom.us';
}

/**
 * @param {string} id - bare channel id or an already-qualified JID
 * @returns {string|null}
 */
export function toChannelJid(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.includes('@')) return id; // already a full JID
  return `${id}@conference.${getXmppDomain().replace(/^@/, '')}`;
}
