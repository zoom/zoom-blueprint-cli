import { sendChatMessage, buildTextContent } from '../zoom/chatbot-api.js';
import { getConversationHistory, appendConversationTurns } from '../../utils/state-store.js';
import { toZoomMarkdown } from '../zoom/markdown.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

export const CLAUDE_SETUP_MESSAGE =
  'Claude replies are disabled. Add ANTHROPIC_API_KEY to .env and restart to enable them.';

export function isClaudeConfigured() {
  const key = process.env.ANTHROPIC_API_KEY;
  return Boolean(key?.startsWith('sk-ant-') && !/\s|\.\.\.|\{\{/.test(key));
}

function buildRequestHeaders() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY in environment variables.');
  if (!apiKey.startsWith('sk-ant-')) throw new Error('Invalid ANTHROPIC_API_KEY format. Should start with "sk-ant-".');

  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };
}

function buildRequestBody({ model, messages, stream }) {
  return {
    model,
    max_tokens: 1000,
    temperature: 0.7,
    system:
      'You are a helpful AI assistant integrated with Zoom Chat. Provide concise, helpful responses. ' +
      'Format replies using ONLY the markdown Zoom Chat supports: **bold**, _italic_, ~strikethrough~, ' +
      '`inline code`, and > blockquotes. Do NOT use "#" headers, bulleted/numbered list markers, tables, or ' +
      '``` code fences — Zoom does not render them. For section titles use **bold** on its own line. Keep ' +
      'answers short and skimmable.',
    messages,
    stream,
  };
}

/**
 * Send a message to Claude and deliver the response back to Zoom Chat.
 * Maintains per-user conversation history for multi-turn exchanges.
 * @param {Object} payload - { toJid, cmd, reply_to, userJid }
 * @param {Object} options - { stream?, onStreamChunk?, skipSend? }
 *   skipSend: return the completion text WITHOUT posting to Zoom (so the caller
 *   can edit an existing placeholder message in place). When skipSend is set,
 *   errors are re-thrown for the caller to handle instead of posting a message.
 * @returns {Promise<string>} the completion text
 */
export async function callAnthropicAPI(payload, options = {}) {
  const toJid = payload?.toJid;
  if (!toJid) {
    console.error('callAnthropicAPI: payload.toJid is missing.');
    return;
  }

  const { stream = true, onStreamChunk = null, skipSend = false } = options;
  if (!isClaudeConfigured()) {
    if (!skipSend) {
      await sendChatMessage(toJid, buildTextContent(CLAUDE_SETUP_MESSAGE), payload.reply_to || null);
    }
    return CLAUDE_SETUP_MESSAGE;
  }


  try {
    const headers = buildRequestHeaders();

    const userContent = payload.cmd || payload.message || 'Hello';
    const history = await getConversationHistory(toJid);
    const messages = [...history, { role: 'user', content: userContent }];

    const requestBody = buildRequestBody({ model: DEFAULT_MODEL, messages, stream });

    const completion = stream
      ? await handleStreamingResponse(requestBody, headers, toJid, payload, onStreamChunk, userContent, skipSend)
      : await handleNonStreamingResponse(requestBody, headers, toJid, payload, userContent, skipSend);

    return completion;
  } catch (error) {
    console.error('callAnthropicAPI error:', error?.message || error);

    const status = error?.status ?? error?.response?.status;
    if (status === 401) console.error('Anthropic: Authentication failed. Check ANTHROPIC_API_KEY.');
    if (status === 429) console.error('Anthropic: Rate limit exceeded.');
    if (status === 400) console.error('Anthropic: Bad request — check model/params.');
    if (status === 404) console.error('Anthropic: Model not found for your account/region.');

    // When the caller manages the message (skipSend), let it handle the failure
    // (e.g. edit the placeholder to an error card). Otherwise post an error here.
    if (skipSend) throw error;

    try {
      await sendChatMessage(
        toJid,
        buildTextContent('Sorry, I hit an AI model error. I will be back shortly. (Check model access/config.)'),
        payload?.reply_to || null,
        payload?.userJid || null
      );
    } catch (sendError) {
      console.error('Failed to send error message to Zoom:', sendError?.message || sendError);
    }
  }
}

/**
 * Non-streaming request to Anthropic. Sends the full reply to Zoom in one message.
 */
async function handleNonStreamingResponse(requestBody, headers, toJid, payload, userContent, skipSend = false) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...requestBody, stream: false }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(async () => ({ message: await response.text() }));
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const data = await response.json();

  if (!data?.content || !Array.isArray(data.content)) {
    throw new Error(`Unexpected Anthropic response shape: ${JSON.stringify(data)}`);
  }

  const completion = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  if (!completion) throw new Error('Empty response from Anthropic API');

  await appendConversationTurns(toJid, [
    { role: 'user', content: userContent },
    { role: 'assistant', content: completion },
  ]);

  // skipSend: caller edits its own placeholder with the returned text.
  if (!skipSend) {
    await sendChatMessage(
      toJid,
      buildTextContent(toZoomMarkdown(completion)),
      payload.reply_to || null,
      payload.userJid || null,
      { markdown: true }
    );
  }

  return completion;
}

/**
 * Streaming request to Anthropic using Server-Sent Events (SSE).
 * Accumulates the full response, then sends it to Zoom as one message.
 */
async function handleStreamingResponse(requestBody, headers, toJid, payload, onStreamChunk, userContent, skipSend = false) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify({ ...requestBody, stream: true }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(async () => ({ message: await response.text() }));
    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
    error.status = response.status;
    error.response = { data: errorData };
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completion = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines (\n\n)
      let separatorIndex;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        let dataLine = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }

        if (!dataLine || dataLine === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataLine);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const chunk = parsed.delta.text || '';
            if (chunk) {
              completion += chunk;
              onStreamChunk?.(chunk, completion);
            }
          }
        } catch {
          // Ignore malformed SSE frames
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  if (!completion.trim()) throw new Error('Empty response from Anthropic streaming API');

  await appendConversationTurns(toJid, [
    { role: 'user', content: userContent },
    { role: 'assistant', content: completion },
  ]);

  // skipSend: caller edits its own placeholder with the returned text.
  if (!skipSend) {
    await sendChatMessage(
      toJid,
      buildTextContent(toZoomMarkdown(completion)),
      payload.reply_to || null,
      payload.userJid || null,
      { markdown: true }
    );
  }

  return completion;
}

