import { describe, it, expect } from 'vitest';
import {
  findUnresolvedPlaceholders,
  manifestHasPlaceholders,
  assertHttpsUrl,
} from '../../src/manifest/resolve.js';
import { buildResolvedManifest, BOOTSTRAP_DEV_URL, loadCanonicalManifest } from '../../src/manifest/project.js';
import { getTemplate } from '../../src/templates/registry.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const placeholderManifest = () => ({
  manifest: {
    display_information: { display_name: '{{APP_NAME}}' },
    oauth_information: {
      usage: 'USER_OPERATION',
      development_redirect_uri: '{{DEV_BASE_URL}}/auth/callback',
      oauth_allow_list: ['{{DEV_BASE_URL}}/auth/callback', 'https://oauth.pstmn.io/v1/callback'],
    },
    features: {
      development_home_uri: '{{DEV_BASE_URL}}/webview',
      event_subscription: { enable: true, events: [{ development_webhook_url: '{{DEV_BASE_URL}}/webhooks' }] },
    },
  },
});

describe('placeholder helpers', () => {
  it('finds + reports unresolved placeholders', () => {
    expect(findUnresolvedPlaceholders({ a: '{{DEV_BASE_URL}}/x', b: ['{{APP_NAME}}'] }).sort()).toEqual([
      'APP_NAME',
      'DEV_BASE_URL',
    ]);
    expect(manifestHasPlaceholders({ a: 'no tokens' })).toBe(false);
    expect(manifestHasPlaceholders({ a: '{{X}}' })).toBe(true);
  });

  it('assertHttpsUrl rejects non-https and malformed URLs', () => {
    expect(() => assertHttpsUrl('https://ok.ngrok.app')).not.toThrow();
    expect(() => assertHttpsUrl('http://insecure.example.com')).toThrow(/https/);
    expect(() => assertHttpsUrl('not a url')).toThrow(/valid URL/);
  });
});

describe('buildResolvedManifest — placeholder templates', () => {
  it('substitutes only supported tokens, preserves suffixes and static entries', () => {
    const canonical = placeholderManifest();
    const out = buildResolvedManifest(canonical, { appName: 'My Bot', baseUrl: 'https://abc.ngrok.app' });
    const m = out.manifest;
    expect(m.display_information.display_name).toBe('My Bot');
    expect(m.oauth_information.development_redirect_uri).toBe('https://abc.ngrok.app/auth/callback');
    expect(m.oauth_information.oauth_allow_list[0]).toBe('https://abc.ngrok.app/auth/callback');
    expect(m.oauth_information.oauth_allow_list[1]).toBe('https://oauth.pstmn.io/v1/callback'); // static preserved
    expect(m.features.development_home_uri).toBe('https://abc.ngrok.app/webview');
    expect(m.features.event_subscription.events[0].development_webhook_url).toBe('https://abc.ngrok.app/webhooks');
    expect(JSON.stringify(out)).not.toContain('{{');
  });

  it('does NOT mutate the canonical input (immutability)', () => {
    const canonical = placeholderManifest();
    const snapshot = JSON.stringify(canonical);
    buildResolvedManifest(canonical, { appName: 'X', baseUrl: 'https://abc.ngrok.app' });
    expect(JSON.stringify(canonical)).toBe(snapshot); // still contains {{...}}
    expect(snapshot).toContain('{{DEV_BASE_URL}}');
  });

  it('trims a trailing slash on the base URL', () => {
    const out = buildResolvedManifest(placeholderManifest(), { appName: 'X', baseUrl: 'https://abc.ngrok.app/' });
    expect(out.manifest.features.event_subscription.events[0].development_webhook_url).toBe('https://abc.ngrok.app/webhooks');
  });

  it('throws on a missing value (unresolved {{DEV_BASE_URL}})', () => {
    expect(() => buildResolvedManifest(placeholderManifest(), { appName: 'X' })).toThrow(/Unresolved.*DEV_BASE_URL/);
  });

  it('throws on an unknown placeholder', () => {
    const m = { manifest: { display_information: { display_name: '{{WAT}}' }, oauth_information: {}, features: {} } };
    expect(() => buildResolvedManifest(m, { appName: 'X', baseUrl: 'https://a.ngrok.app' })).toThrow(/Unresolved.*WAT/);
  });

  it('rejects a non-https base URL', () => {
    expect(() => buildResolvedManifest(placeholderManifest(), { appName: 'X', baseUrl: 'http://nope' })).toThrow(/https/);
  });
});

describe('buildResolvedManifest — legacy (no placeholders) via urlMappings', () => {
  it('applies urlMappings when the manifest declares no placeholders', () => {
    const canonical = {
      manifest: {
        display_information: { display_name: 'Static' },
        oauth_information: { usage: 'USER_OPERATION', development_redirect_uri: '' },
        features: {},
      },
    };
    const out = buildResolvedManifest(canonical, {
      baseUrl: 'https://abc.ngrok.app',
      urlMappings: [{ path: 'oauth_information.development_redirect_uri', route: '/auth/callback' }],
    });
    expect(out.manifest.oauth_information.development_redirect_uri).toBe('https://abc.ngrok.app/auth/callback');
  });
});

describe('real chat-ai-assistant canonical manifest', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatesDir = path.resolve(here, '../../templates');

  it('is declared with placeholders and resolves to concrete URLs (bootstrap at create)', async () => {
    const tmpl = getTemplate('chat-ai-assistant')!;
    const canonical = await loadCanonicalManifest(templatesDir, `chatbot-services/${tmpl.manifestPath}`);
    expect(manifestHasPlaceholders(canonical)).toBe(true); // template uses placeholders

    const created = buildResolvedManifest(canonical, { appName: 'Meeting Assistant', baseUrl: BOOTSTRAP_DEV_URL });
    expect(JSON.stringify(created)).not.toContain('{{'); // nothing literal submitted to Zoom
    expect(created.manifest.display_information.display_name).toBe('Meeting Assistant');
    expect(created.manifest.features.event_subscription.events[0].development_webhook_url).toBe(
      `${BOOTSTRAP_DEV_URL}/webhooks`,
    );

    const dev = buildResolvedManifest(canonical, { appName: 'Meeting Assistant', baseUrl: 'https://live.ngrok.app' });
    expect(dev.manifest.features.event_subscription.events[0].development_webhook_url).toBe('https://live.ngrok.app/webhooks');
    expect(dev.manifest.oauth_information.oauth_allow_list).toEqual([dev.manifest.oauth_information.development_redirect_uri]);
  });
});


describe('consistent development placeholders across all bundled samples', () => {
  it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
    '%s resolves URLs and hostnames consistently for creation and later sync',
    async (id) => {
      const template = getTemplate(id)!;
      const canonical = await loadCanonicalManifest(
        path.resolve('templates', template.source.type === 'local' ? template.source.directory : ''),
        template.manifestPath!,
      );
      const json = JSON.stringify(canonical);
      expect(json).toContain('{{DEV_BASE_URL}}');
      expect(json).toContain('{{DEV_HOSTNAME}}');
      expect(json).not.toMatch(/oauth\.pstmn\.io|Your\.domain|https:\/\/example\.ngrok/);
      const bootstrap = buildResolvedManifest(canonical, {
        chatCommand: 'consistentapp123', appName: 'Consistent App', baseUrl: BOOTSTRAP_DEV_URL, urlMappings: template.runtime!.urlMappings,
      });
      const baseUrl = 'https://custom.dev.example:8443';
      const resolved = buildResolvedManifest(canonical, {
        chatCommand: 'consistentapp123', appName: 'Consistent App', baseUrl, urlMappings: template.runtime!.urlMappings,
      });
      expect(JSON.stringify(resolved)).not.toContain('{{');
      expect(resolved.manifest.oauth_information.development_redirect_uri).toBe(baseUrl + '/auth/callback');
      expect(resolved.manifest.oauth_information.oauth_allow_list).toEqual([baseUrl + '/auth/callback']);
      const domains = resolved.manifest.features.domain_allow_list.map((entry: { domain: string }) => entry.domain);
      expect(domains).toContain('custom.dev.example');
      expect(domains).toContain('appssdk.zoom.us');
      // Updating an existing remote manifest follows the same mappings as the canonical tokens.
      const updated = buildResolvedManifest(bootstrap, {
        baseUrl, appName: 'Consistent App', urlMappings: template.runtime!.urlMappings,
      });
      expect(updated.manifest.features.domain_allow_list).toEqual(bootstrap.manifest.features.domain_allow_list);
      expect(updated.manifest.oauth_information.development_redirect_uri).toBe(baseUrl + '/auth/callback');
    },
  );
});


describe('mixed placeholder and literal URL resolution', () => {
  it.each(['chat-ai-assistant', 'hitl-workplace-agent', 'zcc-nextjs-sample'])(
    '%s maps all managed URLs on the first pass', (id) => {
      const mappings = getTemplate(id)!.runtime!.urlMappings!;
      const manifest = {
        display_information: { display_name: '{{APP_NAME}}' },
        oauth_information: { development_redirect_uri: 'https://example.ngrok.app/auth/callback' },
        features: { domain_allow_list: ['appssdk.zoom.us'], team_chat_subscription: { slash_command: { command: 'demo' } } },
      };
      const out = buildResolvedManifest(manifest, { appName: 'Demo', baseUrl: 'https://first.ngrok.app', urlMappings: mappings });
      for (const mapping of mappings) {
        const value = mapping.path.split('.').reduce<any>((node, key) => node?.[key], out);
        expect(value).toBe(mapping.kind === 'hostname' ? 'first.ngrok.app' : `https://first.ngrok.app${mapping.route || ''}`);
      }
      expect(out.features.domain_allow_list).toEqual(['appssdk.zoom.us']);
      expect(out.features.team_chat_subscription.slash_command.command).toBe('demo');
      expect(manifest.oauth_information.development_redirect_uri).toContain('example.ngrok.app');
    },
  );
});
