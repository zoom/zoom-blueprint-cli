import { ACTIONS, getWebviewUrl } from '../../../utils/constants.js';

export function buildChannelWelcomeCard(channelName) {
  return {
    head: { text: 'Zoom Chat AI Service Bot', style: { bold: true } },
    body: [
      {
        type: 'message',
        is_markdown_support: true,
        text: `Hello *${channelName}*! I've been added to this channel and I'm here to help.`,
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '*Here is what I can help with:*',
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '<color:#0E71EB|Research Assistant> — Ask questions, get AI-powered answers, and draft professional responses.',
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: '<color:#2E7D32|Employee Appreciation> — Recognize a teammate by filling out a quick appreciation form.',
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        text: 'Type "menu" at any time to see available services.',
      },
    ],
  };
}

export function buildServiceMenuCard() {
  return {
    head: { text: 'Zoom Chat AI Service Bot', style: { bold: true } },
    body: [
      { type: 'message', text: 'Choose a service to get started.' },
      {
        type: 'actions',
        items: [
          {
            text: 'Open Surface App',
            value: ACTIONS.OPEN_APP,
            style: 'Default',
            action: 'dialog',
            dialog: {
              size: 'L',
              title: { text: 'Zoom Workplace Chatbot Demo' },
              link: getWebviewUrl(),
            },
          },
          { text: 'Research Assistant',    value: ACTIONS.START_RESEARCH,    style: 'Primary' },
          { text: 'Employee Appreciation', value: ACTIONS.START_APPRECIATION, style: 'Default' },
        ],
      },
    ],
  };
}
