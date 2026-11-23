import { ACTIONS } from '../../../utils/constants.js';

export function buildAppreciationIntroCard() {
  return {
    head: { text: 'Employee Appreciation', style: { bold: true } },
    body: [
      {
        type: 'message',
        text: 'Who would you like to appreciate? Enter their full name.',
      },
    ],
  };
}

export function buildAppreciationEmailCard() {
  return {
    head: { text: 'Employee Appreciation', style: { bold: true } },
    body: [
      {
        type: 'message',
        text: "Enter the employee's email address.",
      },
    ],
  };
}

export function buildAppreciationFormCard() {
  return {
    settings: {
      form: true,
    },
    head: {
      text: 'Appreciation',
      style: { bold: true },
    },
    body: [
      // Form fields must be inside a section
      {
        type: 'section',
        sections: [
          {
            type: 'message',
            text: 'Complete the appreciation details below.',
            style: { bold: true },
          },
          {
            type: 'plain_text_input',
            action_id: 'what_was_done',
            text: 'What was done?',
            value: '',
            placeholder: 'Describe what the person did',
            multiline: true,
            min_length: 0,
            max_length: 2000,
          },
          {
            type: 'plain_text_input',
            action_id: 'why_it_mattered',
            text: 'Why it mattered',
            value: '',
            placeholder: 'Explain why it mattered',
            multiline: true,
            min_length: 0,
            max_length: 2000,
          },
          {
            type: 'plain_text_input',
            action_id: 'who_it_helped',
            text: 'Who it helped',
            value: '',
            placeholder: 'Describe who benefited',
            multiline: true,
            min_length: 0,
            max_length: 2000,
          },
        ],
      },
      // Action buttons must be at the body level to render in a form card
      {
        type: 'actions',
        items: [
          { text: 'Submit', value: ACTIONS.SUBMIT_APPRECIATION, style: 'Primary', submit: true },
          { text: 'Cancel', value: ACTIONS.CANCEL_APPRECIATION, style: 'Danger' },
        ],
      },
      {
        type: 'message',
        text: 'You can also type "cancel" to stop at any time.',
      },
    ],
  };
}


export function buildConfirmationCard(recipient, fields) {
  return {
    settings: {},
    body: [
      {
        type: 'message',
        text: 'Thanks! Your appreciation has been captured.',
        style: { bold: true },
      },
      {
        type: 'divider',
        style: { bold: false, dotted: false, color: '#98a0a9' },
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: `*Recipient:*\n<color:#0E71EB|${recipient}>`,
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: `*What was done:*\n<color:#2E7D32|${fields.what_was_done}>`,
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: `*Why it mattered:*\n<color:#8E24AA|${fields.why_it_mattered}>`,
      },
      {
        type: 'message',
        is_markdown_support: true,
        text: `*Who it helped:*\n<color:#EF6C00|${fields.who_it_helped}>`,
      },
    ],
  };
}
