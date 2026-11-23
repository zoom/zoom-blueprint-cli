import { describe, it, expect } from 'vitest';
import { TEMPLATES, compatibleTemplates, getTemplate } from '../../src/templates/registry.js';
import { replacePlaceholders } from '../../src/templates/scaffold.js';
import { PROVIDERS, PROVIDER_IDS, getProvider } from '../../src/providers.js';

describe('template registry', () => {
  it('only offers compatible templates per app type + provider', () => {
    const general = compatibleTemplates('general', 'anthropic');
    expect(general.length).toBeGreaterThan(0);
    expect(general.every((t) => t.compatibleAppTypes.includes('general'))).toBe(true);

    expect(TEMPLATES.every(t => t.compatibleAppTypes.every(type => type === 'general'))).toBe(true);
  });

  it('declares the chat sample as a General App', () => {
    const chat = getTemplate('chat-ai-assistant')!;
    expect(chat.compatibleAppTypes).toEqual(['general']);

  });

  it('every template declares a known provider, a source, surfaces, and integration mode', () => {
    for (const t of TEMPLATES) {
      expect(t.supportedProviders.every((p) => PROVIDER_IDS.includes(p))).toBe(true);
      expect(t.source.type).toMatch(/local|github/);
      expect(t.supportedSurfaces.length).toBeGreaterThan(0);
      expect(['sample-native', 'fetch', 'none']).toContain(t.providerIntegration);
      expect(typeof t.claudeCodeSupported).toBe('boolean');
    }
  });

  it('filters the Anthropic-only chat assistant out of an OpenAI selection', () => {
    const chat = getTemplate('chat-ai-assistant')!;
    expect(chat.supportedProviders).toEqual(['anthropic']);
    expect(compatibleTemplates('general', 'openai').find((t) => t.id === 'chat-ai-assistant')).toBeUndefined();
    expect(compatibleTemplates('general', 'anthropic').find((t) => t.id === 'chat-ai-assistant')).toBeTruthy();
  });

  it('exposes the chat assistant\'s bundled, capability-complete manifest', () => {
    expect(getTemplate('chat-ai-assistant')!.manifestPath).toBe('0-app-manifest/app-manifest.json');
  });

  it('registers the HITL workplace agent template', () => {
    const hitl = getTemplate('hitl-workplace-agent')!;
    expect(hitl.supportedSurfaces).toContain('team_chat');
    expect(hitl.supportedSurfaces).toContain('rtms');
    expect(hitl.compatibleAppTypes).toEqual(['general']);
    expect(hitl.supportedProviders).toEqual(['anthropic', 'openai']);
    expect(hitl.claudeCodeSupported).toBe(true);
    expect(hitl.manifestPath).toBe('0-app-manifest/app-manifest.json');
  });
});

describe('providers', () => {
  it('maps each provider to a distinct key env', () => {
    expect(PROVIDERS.anthropic.keyEnv).toBe('ANTHROPIC_API_KEY');
    expect(PROVIDERS.openai.keyEnv).toBe('OPENAI_API_KEY');
    expect(() => getProvider('nope' as any)).toThrow();
  });
});

describe('replacePlaceholders', () => {
  it('replaces known tokens and leaves unknown ones intact', () => {
    const out = replacePlaceholders('Hi {{APP_NAME}} / {{MISSING}}', { APP_NAME: 'Bot' });
    expect(out).toBe('Hi Bot / {{MISSING}}');
  });
});
