import { ACTIONS, MENU_TRIGGERS, CANCEL_TRIGGERS } from '../utils/constants.js';
import { getState, clearState } from '../utils/state-store.js';
import { sendChatMessage, buildTextContent } from '../services/zoom/chatbot-api.js';
import { buildServiceMenuCard } from '../services/zoom/cards/menu-cards.js';
import * as ResearchHandler from './research-handler.js';
import * as AppreciationHandler from './appreciation-handler.js';

/**
 * Central dispatcher for interactive_message_actions button clicks.
 * threadId is the replyMainMessageId from the webhook — present when the button
 * was clicked inside an existing thread.
 */
export async function handleBotAction(actionValue, toJid, userJid, payload, threadId = null) {
  try {
    switch (actionValue) {
      case ACTIONS.OPEN_MENU:
        await sendChatMessage(toJid, buildServiceMenuCard(), threadId, userJid);
        break;

      case ACTIONS.OPEN_APP:
        // The "Open App" button uses a client-side dialog action to open the
        // Zoom App webview — no server response is needed. Ignore any webhook
        // Zoom may still emit so it doesn't fall through to the default case.
        break;

      case ACTIONS.START_RESEARCH:
        await ResearchHandler.handleResearchAction(ACTIONS.START_RESEARCH, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_ASK_QUESTION:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_ASK_QUESTION, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_SUMMARIZE_THREAD:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_SUMMARIZE_THREAD, toJid, userJid, threadId);
        break;

      case ACTIONS.RESEARCH_DRAFT_RESPONSE:
        await ResearchHandler.handleResearchAction(ACTIONS.RESEARCH_DRAFT_RESPONSE, toJid, userJid, threadId);
        break;

      case ACTIONS.START_APPRECIATION:
        await AppreciationHandler.startAppreciationFlow(toJid, userJid, threadId);
        break;

      case ACTIONS.CANCEL_APPRECIATION:
        await AppreciationHandler.handleAppreciationAction(actionValue, toJid, userJid, threadId);
        break;

      default:
        console.warn(`handleBotAction: unrecognized action "${actionValue}"`);
        await sendChatMessage(toJid, buildTextContent("I didn't recognize that action. Type 'menu' to see available services."), threadId, userJid);
        break;
    }
  } catch (error) {
    console.error('handleBotAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId, userJid);
  }
}

/**
 * Called from bot_notification. Routes menu triggers and flow-state text messages.
 * threadId is replyMainMessageId from the webhook — present when the user's message
 * was sent inside an existing thread.
 */
export async function handleTextMessage(toJid, userJid, message, threadId = null) {
  const lower = message.toLowerCase().trim();

  try {
    // Cancel triggers stop any active flow and confirm — no menu redirect
    if (CANCEL_TRIGGERS.includes(lower)) {
      await clearState(userJid);
      await sendChatMessage(toJid, buildTextContent("Got it — I've stopped. Type 'menu' whenever you're ready."), threadId, userJid);
      return;
    }

    // Menu triggers show the main service menu
    if (MENU_TRIGGERS.includes(lower)) {
      await sendChatMessage(toJid, buildServiceMenuCard(), threadId, userJid);
      return;
    }

    // Route based on current flow step
    const state = await getState(userJid);

    // For mid-flow steps, prefer the threadId from the current event.
    // Fall back to the threadId stored when the flow was started (covers cases
    // where the user replies from outside the original thread context).
    const replyTo = threadId || state.threadId || null;

    switch (state.step) {
      case 'awaiting_research_question':
        await ResearchHandler.handleResearchQuestion(toJid, userJid, message, replyTo);
        break;

      case 'awaiting_draft_context':
        await ResearchHandler.handleDraftContext(toJid, userJid, message, replyTo);
        break;

      case 'awaiting_name':
      case 'awaiting_email':
        await AppreciationHandler.handleAppreciationText(toJid, userJid, message, replyTo);
        break;

      default:
        await sendChatMessage(toJid, buildTextContent("Type 'menu' to see available services."), threadId, userJid);
        break;
    }
  } catch (error) {
    console.error('handleTextMessage error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId, userJid);
  }
}
