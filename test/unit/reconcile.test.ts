import { describe, it, expect, vi } from 'vitest';
import {
  reconcileConfig,
  isPlaceholderValue,
  validateBotJid,
  validateSecretToken,
  type ReconcileDeps,
} from '../../src/config/reconcile.js';
import type { EnvReconcileSpec } from '../../src/templates/registry.js';

// chat-ai-assistant-shaped spec used across cases.
const SPEC: EnvReconcileSpec = {
  urlVars: [
    { name: 'ZOOM_REDIRECT_URI', route: '/auth/callback', kind: 'url', label: 'OAuth redirect' },
    { name: 'FRONTEND_ORIGIN', kind: 'origin', label: 'CORS origin' },
  ],
  promptVars: [
    { name: 'ZOOM_BOT_JID', label: 'Bot JID', validate: 'botJid' },
    { name: 'ZOOM_VERIFICATION_TOKEN', label: 'Secret Token', validate: 'secretToken' },
  ],
  generateVars: [{ name: 'SESSION_SECRET', label: 'Session secret' }],
  appNameVar: { name: 'ZOOM_BOT_NAME', label: 'Bot name' },
};

/** Run reconcile against an in-memory .env (no real fs), capturing writes. */
function run(contents: string | null, opts: Parameters<typeof reconcileConfig>[0], extra: ReconcileDeps = {}) {
  const writes: Array<{ key: string; value: string }> = [];
  const deps: ReconcileDeps = {
    readEnv: async () => contents,
    writeEnv: async (_p, entries) => {
      writes.push(...entries);
      return { path: '/tmp/.env', created: contents === null };
    },
    generateSecret: () => 'GENERATED_SECRET',
    ...extra,
  };
  return reconcileConfig(opts, deps).then((result) => ({ result, writes }));
}

describe('isPlaceholderValue', () => {
  it('flags empty, your_x_here, tunnel/upstash/change-this patterns and {{tokens}}', () => {
    for (const v of [
      '',
      '   ',
      undefined,
      null,
      'your_bot_jid_here',
      'https://your_tunnel_url_here/auth/callback',
      'https://your-db-name.upstash.io',
      'change-this-to-a-long-random-string-in-production',
      '{{DEV_BASE_URL}}/webhooks',
      'app-client-id',
      'app-client-secret',
      'created-app-id',
      'xxxxxxxx@xmpp.zoom.us',
      'sk-...',
      'sk-ant-...',
      'https://example.ngrok.app/auth/callback',
    ]) {
      expect(isPlaceholderValue(v as any)).toBe(true);
    }
  });
  it('accepts real values', () => {
    for (const v of ['bot@xmpp.zoom.us', 'https://abc.ngrok.app/auth/callback', 'a1b2c3d4e5f6']) {
      expect(isPlaceholderValue(v)).toBe(false);
    }
  });
});

describe('validators', () => {
  it('validateBotJid requires local@domain', () => {
    expect(validateBotJid('v1abc@xmpp.zoom.us')).toBeNull();
    expect(validateBotJid('your_bot_jid_here')).toMatch(/placeholder/);
    expect(validateBotJid('not-a-jid')).toMatch(/form/);
    expect(validateBotJid('a b@x')).toMatch(/spaces/);
  });
  it('validateSecretToken requires a non-trivial opaque string', () => {
    expect(validateSecretToken('s3cr3t-token-value')).toBeNull();
    expect(validateSecretToken('short')).toMatch(/short/);
    expect(validateSecretToken('your_verification_token_here')).toMatch(/placeholder/);
  });
});

describe('reconcileConfig — URL-derived values', () => {
  it('fills placeholder URL vars from the active base URL (+route / origin)', async () => {
    const env = 'ZOOM_REDIRECT_URI=https://your_tunnel_url_here/auth/callback\nFRONTEND_ORIGIN=http://localhost:3000\n';
    const { result, writes } = await run(env, {
      dir: '/p',
      spec: { urlVars: SPEC.urlVars },
      baseUrl: 'https://abc.ngrok.app',
      interactive: false,
    });
    expect(writes).toContainEqual({ key: 'ZOOM_REDIRECT_URI', value: 'https://abc.ngrok.app/auth/callback' });
    expect(writes).toContainEqual({ key: 'FRONTEND_ORIGIN', value: 'https://abc.ngrok.app' });
    expect(result.wrote).toBe(true);
  });

  it('refreshes a STALE ngrok host automatically (generated value)', async () => {
    const env = 'ZOOM_REDIRECT_URI=https://old123.ngrok.app/auth/callback\n';
    const { writes } = await run(env, {
      dir: '/p',
      spec: { urlVars: [SPEC.urlVars![0]] },
      baseUrl: 'https://new456.ngrok.app',
      interactive: false,
    });
    expect(writes).toContainEqual({ key: 'ZOOM_REDIRECT_URI', value: 'https://new456.ngrok.app/auth/callback' });
  });

  it('PRESERVES a deliberate non-dev URL unless confirmed', async () => {
    const env = 'ZOOM_REDIRECT_URI=https://prod.example.com/auth/callback\n';
    const confirm = vi.fn(async () => false);
    const { writes } = await run(
      env,
      { dir: '/p', spec: { urlVars: [SPEC.urlVars![0]] }, baseUrl: 'https://abc.ngrok.app', interactive: false },
      { confirm },
    );
    expect(writes).toHaveLength(0);
    expect(confirm).toHaveBeenCalled();
  });

  it('defers URL vars (reports unresolved) when no base URL is known', async () => {
    const { result, writes } = await run('ZOOM_REDIRECT_URI=https://your_tunnel_url_here/auth/callback\n', {
      dir: '/p',
      spec: { urlVars: [SPEC.urlVars![0]] },
      interactive: false,
    });
    expect(writes).toHaveLength(0);
    expect(result.unresolved.map((u) => u.key)).toContain('ZOOM_REDIRECT_URI');
  });
});

describe('reconcileConfig — generated secrets', () => {
  it('generates SESSION_SECRET when placeholder; redacts it in the report', async () => {
    const { result, writes } = await run('SESSION_SECRET=change-this-to-a-long-random-string-in-production\n', {
      dir: '/p',
      spec: { generateVars: SPEC.generateVars },
      interactive: false,
    });
    expect(writes).toContainEqual({ key: 'SESSION_SECRET', value: 'GENERATED_SECRET' });
    const change = result.changes.find((c) => c.key === 'SESSION_SECRET');
    expect(change?.display).not.toContain('GENERATED_SECRET'); // never echoed
  });

  it('never overwrites an existing real secret', async () => {
    const { writes } = await run('SESSION_SECRET=an-already-strong-secret-value\n', {
      dir: '/p',
      spec: { generateVars: SPEC.generateVars },
      interactive: false,
    });
    expect(writes).toHaveLength(0);
  });
});

describe('reconcileConfig — developer-supplied prompts', () => {
  it('prompts + validates placeholder values when interactive (retries on invalid)', async () => {
    const answers = ['not-a-jid', 'bot@xmpp.zoom.us']; // first invalid, then valid
    const prompt = vi.fn(async () => answers.shift());
    const { writes } = await run(
      'ZOOM_BOT_JID=your_bot_jid_here\n',
      { dir: '/p', spec: { promptVars: [SPEC.promptVars![0]] }, interactive: true },
      { prompt },
    );
    expect(writes).toContainEqual({ key: 'ZOOM_BOT_JID', value: 'bot@xmpp.zoom.us' });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('saves an accepted setting before the next prompt and resumes with only the remaining setting', async () => {
    const marketplaceAppUrl = 'https://marketplace.zoom.us/develop/applications/APP1/information';
    const opts = { dir: '/p', spec: { promptVars: SPEC.promptVars }, interactive: true, marketplaceAppUrl };
    let contents = '';
    const deps: ReconcileDeps = {
      readEnv: async () => contents,
      writeEnv: async (envPath, entries) => {
        for (const { key, value } of entries) contents += `${key}=${value}\n`;
        return { path: envPath, created: false };
      },
      prompt: vi.fn()
        .mockResolvedValueOnce('bot@xmpp.zoom.us')
        .mockRejectedValueOnce(new Error('interrupted')),
    };

    await expect(reconcileConfig(opts, deps)).rejects.toThrow('interrupted');
    expect(contents).toBe('ZOOM_BOT_JID=bot@xmpp.zoom.us\n');

    const prompt = vi.fn(async () => '');
    const result = await reconcileConfig(opts, { ...deps, prompt });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Secret Token'),
      help: expect.stringContaining(marketplaceAppUrl),
      secret: true,
    }));
    expect(result.unresolved).toEqual([expect.objectContaining({
      key: 'ZOOM_VERIFICATION_TOKEN',
      how: expect.stringContaining(marketplaceAppUrl),
    })]);
  });

  it('reports unresolved (no prompt) when non-interactive', async () => {
    const prompt = vi.fn();
    const { result, writes } = await run(
      'ZOOM_BOT_JID=your_bot_jid_here\n',
      { dir: '/p', spec: { promptVars: [SPEC.promptVars![0]] }, interactive: false },
      { prompt },
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(result.unresolved.map((u) => u.key)).toContain('ZOOM_BOT_JID');
  });

  it('keeps an existing real Bot JID untouched (no prompt)', async () => {
    const prompt = vi.fn();
    const { writes } = await run(
      'ZOOM_BOT_JID=real@xmpp.zoom.us\n',
      { dir: '/p', spec: { promptVars: [SPEC.promptVars![0]] }, interactive: true },
      { prompt },
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('reconcileConfig — app name + required reporting', () => {
  it('defaults the bot name from Marketplace app metadata', async () => {
    const getAppName = vi.fn(async () => 'My Support Bot');
    const { writes } = await run(
      'ZOOM_BOT_NAME=your_bot_display_name_here\n',
      { dir: '/p', spec: { appNameVar: SPEC.appNameVar }, appId: 'APP1', interactive: false },
      { getAppName },
    );
    expect(writes).toContainEqual({ key: 'ZOOM_BOT_NAME', value: 'My Support Bot' });
  });

  it('reports remaining required env vars as unresolved', async () => {
    const { result } = await run('PORT=4000\n', {
      dir: '/p',
      spec: {},
      requiredEnv: ['ANTHROPIC_API_KEY', 'PORT'],
      interactive: false,
    });
    const keys = result.unresolved.map((u) => u.key);
    expect(keys).toContain('ANTHROPIC_API_KEY');
    expect(keys).not.toContain('PORT'); // PORT is set
  });

  it('is a no-op (no write) when everything is already resolved', async () => {
    const env =
      'ZOOM_REDIRECT_URI=https://abc.ngrok.app/auth/callback\nFRONTEND_ORIGIN=https://abc.ngrok.app\n' +
      'ZOOM_BOT_JID=bot@xmpp.zoom.us\nZOOM_VERIFICATION_TOKEN=a-real-secret-token\n' +
      'SESSION_SECRET=an-already-strong-secret\nZOOM_BOT_NAME=Support Bot\n';
    const { result, writes } = await run(env, {
      dir: '/p',
      spec: SPEC,
      baseUrl: 'https://abc.ngrok.app',
      appId: 'APP1',
      interactive: true,
    });
    expect(writes).toHaveLength(0);
    expect(result.wrote).toBe(false);
    expect(result.unresolved).toHaveLength(0);
  });
});
