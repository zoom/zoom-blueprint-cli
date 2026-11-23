import { sendChatMessage, buildTextContent, editChatbotMessage } from '../services/zoom/chatbot-api.js';
import { callAnthropicAPI, CLAUDE_SETUP_MESSAGE, isClaudeConfigured } from '../services/ai/anthropic-client.js';
import { setState, getState } from '../utils/state-store.js';
import { buildResearchMenuCard, buildResearchPendingCard } from '../services/zoom/cards/research-cards.js';
import { toZoomMarkdown } from '../services/zoom/markdown.js';
import { ACTIONS } from '../utils/constants.js';

/**
 * Route a research action button click to the appropriate sub-flow.
 * threadId is the replyMainMessageId from the interactive_message_actions event.
 */
export async function handleResearchAction(action, toJid, userJid, threadId = null) {
  try {
    switch (action) {
      case ACTIONS.START_RESEARCH: {
        await setState(userJid, { service: 'RESEARCH', step: null, threadId });
        await sendChatMessage(toJid, buildResearchMenuCard(), threadId, userJid);
        break;
      }

      case ACTIONS.RESEARCH_ASK_QUESTION: {
        const sent = await sendChatMessage(
          toJid,
          buildTextContent('What question would you like to research? Type your question now.'),
          threadId,
          userJid
        );
        // Store both the event thread root and the bot's own prompt message ID.
        // handleResearchQuestion uses whichever is available as the reply target.
        const threadMessageId = sent?.id || sent?.message_id || sent?.messageId || null;
        await setState(userJid, { step: 'awaiting_research_question', threadId, threadMessageId });
        break;
      }

      case ACTIONS.RESEARCH_SUMMARIZE_THREAD: {
        await summarizeThread(toJid, threadId, userJid);
        break;
      }

      case ACTIONS.RESEARCH_DRAFT_RESPONSE: {
        const sent = await sendChatMessage(
          toJid,
          buildTextContent('Provide the context or thread you would like me to draft a response for.'),
          threadId,
          userJid
        );
        const threadMessageId = sent?.id || sent?.message_id || sent?.messageId || null;
        await setState(userJid, { step: 'awaiting_draft_context', threadId, threadMessageId });
        break;
      }

      default:
        console.warn(`handleResearchAction: unhandled action "${action}"`);
        break;
    }
  } catch (error) {
    console.error('handleResearchAction error:', error);
    await sendChatMessage(toJid, buildTextContent("Something went wrong. Type 'menu' to start again."), threadId, userJid);
  }
}

/**
 * Two-phase "thinking message" pattern. Zoom bots can't stream tokens into a
 * message, and an AI call takes seconds — so:
 *   1. Immediately send a lightweight "Analyzing…" placeholder (instant feedback).
 *   2. Capture its message ID.
 *   3. Run the slow Claude call (skipSend → returns text, posts nothing).
 *   4. Edit the placeholder in place with the final answer (one bubble, no stream).
 * On failure the placeholder is edited to an error message so the user is never
 * left staring at a stale "Analyzing…" bubble.
 * @param {string} toJid
 * @param {string} userJid
 * @param {string} prompt  - the text sent to Claude
 * @param {string|null} replyTo - thread root for the placeholder
 */
async function runWithThinkingMessage(toJid, userJid, prompt, replyTo) {
  if (!isClaudeConfigured()) {
    await sendChatMessage(toJid, buildTextContent(CLAUDE_SETUP_MESSAGE), replyTo, userJid);
    return;
  }

  let pendingMessageId = null;
  try {
    // 1–2. Instant placeholder; capture its ID (Zoom's key varies).
    const pending = await sendChatMessage(toJid, buildResearchPendingCard(), replyTo, userJid);
    pendingMessageId = pending?.id || pending?.message_id || pending?.messageId || null;

    // 3. Slow AI call — returns the answer text without posting to Zoom.
    const answer = await callAnthropicAPI(
      { toJid, cmd: prompt, reply_to: replyTo, userJid },
      { skipSend: true }
    );
    const card = buildTextContent(toZoomMarkdown(answer));

    // 4. Swap the placeholder for the answer (edit inherits the thread position).
    //    If we somehow have no ID to edit, fall back to a fresh message.
    if (pendingMessageId) {
      await editChatbotMessage(pendingMessageId, toJid, userJid, card, { markdown: true });
    } else {
      await sendChatMessage(toJid, card, replyTo, userJid, { markdown: true });
    }
  } catch (error) {
    console.error('runWithThinkingMessage error:', error);
    const errorCard = buildTextContent("Sorry, I couldn't complete that. Type 'menu' to start again.");
    try {
      if (pendingMessageId) await editChatbotMessage(pendingMessageId, toJid, userJid, errorCard);
      else await sendChatMessage(toJid, errorCard, replyTo, userJid);
    } catch {
      await sendChatMessage(toJid, errorCard, replyTo, userJid);
    }
  }
}

/**
 * Called when state.step === 'awaiting_research_question'.
 * Threading priority:
 *   1. replyMainMessageId from the current bot_notification (user replied inside a thread)
 *   2. threadId stored in state when the flow started (button was clicked in a thread)
 *   3. threadMessageId — the bot's own "What question?" prompt message ID
 */
export async function handleResearchQuestion(toJid, userJid, question, threadId = null) {
  const state = await getState(userJid);
  const replyTo = threadId || state.threadId || state.threadMessageId || null;
  await runWithThinkingMessage(toJid, userJid, question, replyTo);
  await setState(userJid, { step: null, threadMessageId: null });
}

/**
 * Called when state.step === 'awaiting_draft_context'.
 * Same threading priority and thinking-message pattern as handleResearchQuestion.
 */
export async function handleDraftContext(toJid, userJid, context, threadId = null) {
  const state = await getState(userJid);
  const replyTo = threadId || state.threadId || state.threadMessageId || null;
  const prompt = `Draft a professional response based on this context: ${context}`;
  await runWithThinkingMessage(toJid, userJid, prompt, replyTo);
  await setState(userJid, { step: null, threadMessageId: null });
}

/**
 * Placeholder: thread summarization not yet implemented.
 */
async function summarizeThread(toJid, threadId = null, userJid = null) {
  await sendChatMessage(toJid, buildTextContent('Thread summarization is not yet implemented. Check back soon!'), threadId, userJid);
}
