// Shared test helpers: build a temp project with .zoom-agent.json + a manifest, and a stateful
// fake Marketplace session.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeProjectState, type ProjectState } from '../../src/config/project-state.js';
import type { ZoomManifest } from '../../src/manifest/index.js';
import type { MarketplaceSession } from '../../src/marketplace/session.js';

export async function makeProject(opts: {
  state?: Partial<ProjectState>;
  manifest?: ZoomManifest;
  env?: Record<string, string>;
}): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-proj-'));
  const state: ProjectState = {
    version: 1,
    projectName: 'chat-agent',
    templateId: 'chat-ai-assistant',
    appType: 'general',
    provider: 'anthropic',
    env: 'prod',
    marketplaceSetup: 'auto',
    manifestPath: opts.manifest ? 'manifest.json' : undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...opts.state,
  };
  await writeProjectState(dir, state);
  if (opts.manifest) {
    await fs.writeFile(path.join(dir, state.manifestPath!), JSON.stringify(opts.manifest, null, 2));
  }
  if (opts.env) {
    const text = Object.entries(opts.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    await fs.writeFile(path.join(dir, '.env'), text + '\n');
  }
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** A minimal, structurally-valid General-App manifest (wrapped). */
export function validManifest(displayName = 'Chat Agent'): ZoomManifest {
  return {
    manifest: {
      display_information: { display_name: displayName },
      oauth_information: { usage: 'USER_OPERATION', development_redirect_uri: '', oauth_allow_list: [''] },
      features: {
        development_home_uri: '',
        event_subscription: { enable: true, events: [{ development_webhook_url: '' }] },
        team_chat_subscription: { slash_command: { development_message_url: '' } },
      },
    },
  };
}

/** Stateful fake Marketplace session: getManifest returns current; updateManifest replaces it. */
export function fakeSession(opts: {
  initial: ZoomManifest;
  validate?: (m: ZoomManifest) => { ok: boolean; issues?: { setting?: string; message: string }[] };
}): { session: MarketplaceSession; calls: { validate: number; get: number; update: number } } {
  let current = opts.initial;
  const calls = { validate: 0, get: 0, update: 0 };
  const session: MarketplaceSession = {
    async validate(m) {
      calls.validate++;
      const r = opts.validate ? opts.validate(m) : { ok: true };
      return { ok: r.ok, status: 200, issues: r.issues ?? [], raw: {} };
    },
    async getManifest() {
      calls.get++;
      // Return the inner object (what the real GET returns).
      return (current as any).manifest ?? current;
    },
    async updateManifest(_appId, m) {
      calls.update++;
      current = m;
      return { status: 204 };
    },
    async getApp(appId) {
      return { appId, appName: 'Chat Agent', appType: 'general', appStatus: 'draft', raw: {} };
    },
  };
  return { session, calls };
}
