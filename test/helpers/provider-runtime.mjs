// Execute generated inference modules with isolated environments and mocked transports.
// VM linking avoids installing the samples' native RTMS and database dependencies.
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2];
const requests = [];
const messages = [];
async function load(file, env) {
  const context = vm.createContext({
    process: { env }, console, TextDecoder,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ api: url, ...body });
      if (body.stream) {
        const frame = new TextEncoder().encode('data: ' + JSON.stringify({
          type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude answer' },
        }) + '\n\n');
        let sent = false;
        return { ok: true, body: { getReader: () => ({
          read: async () => sent ? { done: true } : (sent = true, { done: false, value: frame }),
          releaseLock() {},
        }) } };
      }
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Claude answer' }] }) };
    },
  });
  const cache = new Map();
  async function link(file) {
    if (cache.has(file)) return cache.get(file);
    const module = new vm.SourceTextModule(await fs.readFile(file, 'utf8'), { context, identifier: file });
    cache.set(file, module);
    await module.link(async (specifier, parent) => {
      if (specifier.endsWith('openai-client.js') || specifier.endsWith('/ai/config.js') || specifier === './config.js') {
        return link(path.resolve(path.dirname(parent.identifier), specifier));
      }
      const exports = specifier === 'openai' ? {
        default: class {
          constructor() {
            this.chat = { completions: { create: async (body) => {
              requests.push({ api: 'openai-chat', ...body });
              return { choices: [{ message: { content: body.response_format ? JSON.stringify({ tasks: [] }) : 'OpenAI answer' } }] };
            } } };
            this.responses = { create: async (body) => {
              requests.push({ api: 'openai-responses', ...body });
              return { output: [] };
            } };
          }
        },
      } : specifier === 'crypto' ? { default: {} } : {
        default: { getMeetingContext: () => ({ title: 'Test', tasks: [], suggestions: [], transcript: [] }) },
        sendChatMessage: async (...args) => messages.push(args),
        buildTextContent: (text) => ({ text }),
        buildResearchResponseCard: (text) => ({ text }),
        toZoomMarkdown: (text) => text,
        getConversationHistory: async () => [],
        appendConversationTurns: async () => {},
        logger: () => ({ info() {}, warn() {}, error() {} }),
      };
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context });
    });
    return module;
  }
  const module = await link(file);
  await module.evaluate();
  return module.namespace;
}

for (const sample of ['chat', 'hitl']) {
  const base = path.join(root, sample);
  const clientPath = sample === 'chat'
    ? 'src/services/ai/anthropic-client.js' : 'backend/utils/ai/anthropic.js';
  const env = { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'claude-test-model', AI_PROVIDER: 'openai' };
  const client = await load(path.join(base, clientPath), env);
  for (const stream of [false, true]) {
    assert.equal(await client.callAnthropicAPI({ toJid: 'bot', cmd: 'Question' }, { skipSend: true, stream }), 'Claude answer');
    assert.equal(requests.at(-1).api, 'https://api.anthropic.com/v1/messages');
    assert.equal(requests.at(-1).model, 'claude-test-model');
  }
  for (const key of ['', 'your_anthropic_api_key_here', 'sk-ant-...']) {
    const disabled = await load(path.join(base, clientPath), { ANTHROPIC_API_KEY: key });
    const count = requests.length;
    await disabled.callAnthropicAPI({ toJid: 'bot' });
    assert.equal(requests.length, count);
    assert.match(messages.at(-1)[1].text, /disabled.*ANTHROPIC_API_KEY/);
  }
}
const hitl = path.join(root, 'hitl/backend');
const meeting = await load(path.join(hitl, 'utils/ai/meeting-context-agent.js'), {
  OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'openai-test-model', AI_PROVIDER: 'anthropic',
});
assert.equal((await meeting.answerMeetingQuestion('meeting', 'Question')).usedAI, true);
assert.equal(requests.at(-1).api, 'openai-chat');
assert.equal(requests.at(-1).model, 'openai-test-model');

const analyzer = await load(path.join(hitl, 'utils/ai/ai-task-analyzer.js'), {
  OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'openai-test-model',
});
assert.equal((await analyzer.analyzeTranscript([{ speaker: 'Dev', text: 'Follow up' }])).usedAI, true);
assert.equal(requests.at(-1).response_format.type, 'json_schema');
assert.equal(requests.at(-1).response_format.json_schema.strict, true);

for (const key of ['', 'your_openai_api_key_here']) {
  const disabled = await load(path.join(hitl, 'utils/ai/meeting-context-agent.js'), { OPENAI_API_KEY: key });
  const count = requests.length;
  assert.equal((await disabled.answerMeetingQuestion('meeting', 'Question')).usedAI, false);
  assert.equal(requests.length, count);
}
const docs = await load(path.join(hitl, 'utils/zoom/zoom-mcp-docs.js'), {
  OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'openai-test-model',
});
const createDoc = docs.createZoomDocFromMarkdown;
await createDoc({ userAccessToken: 'zoom-test-token', content: 'Approved content', fileName: 'Test' });
const docRequest = requests.at(-1);
assert.equal(docRequest.api, 'openai-responses');
assert.equal(docRequest.tools[0].headers.Authorization, 'Bearer zoom-test-token');
assert.equal(docRequest.tools[0].require_approval, 'never');

const zoomEnv = { ZOOM_CLIENT_ID: 'id', ZOOM_CLIENT_SECRET: 'secret', ZOOM_BOT_JID: 'bot@xmpp.zoom.us', ZOOM_VERIFICATION_TOKEN: 'secret-token' };
const validation = await load(path.join(hitl, 'utils/validation.js'), zoomEnv);
assert.equal(validation.validateEnvironmentVariables().isValid, true);
console.log('Verified feature routing, models, streaming, disabled keys, MCP policy, and HITL startup validation.');
