import { sendChatMessage, buildTextContent } from '../services/zoom/chatbot-api.js';
import { getState, setState, clearState } from '../utils/state-store.js';
import {
  buildAppreciationIntroCard,
  buildAppreciationEmailCard,
  buildAppreciationFormCard,
} from '../services/zoom/cards/appreciation-cards.js';
import { ACTIONS } from '../utils/constants.js';

function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
}

/**
 * Start the appreciation flow. Stores threadId in state so all subsequent
 * steps (including form submission) can thread their responses.
 */
export async function startAppreciationFlow(toJid, userJid, threadId = null) {
  try {
    await setState(userJid, { service: 'APPRECIATION', step: 'awaiting_name', threadId });
    await sendChatMessage(toJid, buildAppreciationIntroCard(), threadId, userJid);
  } catch (error) {
    console.error('startAppreciationFlow error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId, userJid);
  }
}

/**
 * Handle plain-text input during the appreciation flow (name and email steps).
 * threadId is the replyMainMessageId from the current bot_notification event,
 * or the threadId stored in state when the flow was started.
 */
export async function handleAppreciationText(toJid, userJid, message, threadId = null) {
  const state = await getState(userJid);
  const replyTo = threadId || state.threadId || null;

  try {
    switch (state.step) {
      case 'awaiting_name': {
        const name = message.trim();
        await setState(userJid, { recipientName: name, step: 'awaiting_email' });
        await sendChatMessage(toJid, buildAppreciationEmailCard(), replyTo, userJid);
        break;
      }

      case 'awaiting_email': {
        if (!isValidEmail(message)) {
          await sendChatMessage(toJid, buildTextContent('Please enter a valid email address.'), replyTo, userJid);
          return;
        }
        const email = message.trim();
        await setState(userJid, { recipientEmail: email, step: 'awaiting_form' });
        await sendChatMessage(toJid, buildAppreciationFormCard(), replyTo, userJid);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error('handleAppreciationText error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo, userJid);
  }
}

/**
 * Handle button actions during the appreciation flow (e.g. Cancel button).
 */
export async function handleAppreciationAction(actionValue, toJid, userJid, threadId = null) {
  const replyTo = threadId || (await getState(userJid)).threadId || null;

  try {
    switch (actionValue) {
      case ACTIONS.CANCEL_APPRECIATION: {
        await clearState(userJid);
        await sendChatMessage(toJid, buildTextContent("No problem — I canceled this appreciation flow. You can start again anytime."), replyTo, userJid);
        break;
      }

      default:
        console.warn(`handleAppreciationAction: unhandled action "${actionValue}"`);
        break;
    }
  } catch (error) {
    console.error('handleAppreciationAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), replyTo, userJid);
  }
}
