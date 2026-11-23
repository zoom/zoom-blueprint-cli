import { ACTIONS } from '../../../utils/constants.js';

/**
 * Lightweight interim card sent immediately so the user gets instant feedback
 * while the (slow) AI call runs. Its message ID is captured and later edited in
 * place with the final answer — Zoom bots can't stream tokens into a message.
 */
export function buildResearchPendingCard() {
  return {
    head: { text: 'Research Assistant', style: { bold: true } },
    body: [
      { type: 'message', text: '🔎 Analyzing your question…' },
    ],
  };
}

export function buildResearchMenuCard() {
  return {
    head: { text: 'Research Assistant', style: { bold: true } },
    body: [
      { type: 'message', text: 'What would you like help with?' },
      {
        type: 'actions',
        items: [
          { text: 'Ask a Question',        value: ACTIONS.RESEARCH_ASK_QUESTION,      style: 'Primary' },
          { text: 'Summarize This Thread', value: ACTIONS.RESEARCH_SUMMARIZE_THREAD,  style: 'Default' },
          { text: 'Draft a Response',      value: ACTIONS.RESEARCH_DRAFT_RESPONSE,    style: 'Default' },
        ],
      },
    ],
  };
}
