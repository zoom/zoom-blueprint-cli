import { describe, it, expect } from 'vitest';
import {
  innerManifest,
  getPath,
  setPath,
  resolvePlaceholders,
  applyUrlMappings,
  diffManifest,
} from '../../src/manifest/resolve.js';

describe('path helpers', () => {
  it('get/set by dotted path, creating intermediates', () => {
    const o: Record<string, any> = { a: { b: 1 } };
    expect(getPath(o, 'a.b')).toBe(1);
    expect(getPath(o, 'a.x.y')).toBeUndefined();
    setPath(o, 'a.c.d', 'v');
    expect(o.a.c.d).toBe('v');
  });
});

describe('resolvePlaceholders', () => {
  it('replaces {{TOKEN}} in nested strings, leaves unknowns', () => {
    const out = resolvePlaceholders({ url: '{{BASE}}/x', arr: ['{{BASE}}', '{{MISSING}}'] }, { BASE: 'https://h' });
    expect(out).toEqual({ url: 'https://h/x', arr: ['https://h', '{{MISSING}}'] });
  });
});

describe('applyUrlMappings', () => {
  it('sets declared URL fields from a base URL without mutating input (wrapper preserved)', () => {
    const manifest = {
      manifest: {
        display_information: { display_name: 'X' },
        oauth_information: { production_redirect_uri: '' },
        features: { event_subscription: { enable: true, endpoint_url: '' } },
      },
    };
    const out = applyUrlMappings(manifest, 'https://abc.ngrok.app/', [
      { path: 'oauth_information.production_redirect_uri', route: '/auth/callback' },
      { path: 'features.event_subscription.endpoint_url', route: 'webhooks' },
    ]);
    // original untouched
    expect(manifest.manifest.oauth_information.production_redirect_uri).toBe('');
    // wrapper preserved, inner URLs set (trailing slash trimmed, leading slash normalized)
    expect(out.manifest.oauth_information.production_redirect_uri).toBe('https://abc.ngrok.app/auth/callback');
    expect(out.manifest.features.event_subscription.endpoint_url).toBe('https://abc.ngrok.app/webhooks');
  });
});

describe('diffManifest', () => {
  const remote = {
    display_information: { display_name: 'Old Name' },
    oauth_information: { production_redirect_uri: 'https://old/cb', client_secret: 'SEKRET' },
    features: { products: ['ZOOM_CHAT'] },
  };
  const local = {
    display_information: { display_name: 'New Name' },
    oauth_information: { production_redirect_uri: 'https://new/cb', client_secret: 'OTHER' },
    features: { products: ['ZOOM_CHAT'], event_subscription: { enable: true } },
  };

  it('reports changed/added leaves and redacts secret paths', () => {
    const d = diffManifest(local, remote);
    const byPath = Object.fromEntries(d.map((e) => [e.path, e]));
    expect(byPath['display_information.display_name']).toMatchObject({ type: 'changed', local: 'New Name', remote: 'Old Name' });
    expect(byPath['oauth_information.production_redirect_uri'].type).toBe('changed');
    // secret-ish path is redacted both sides
    expect(byPath['oauth_information.client_secret'].local).toBe('***REDACTED***');
    expect(byPath['oauth_information.client_secret'].remote).toBe('***REDACTED***');
    // added feature block
    expect(byPath['features.event_subscription'].type).toBe('added');
  });

  it('returns empty for identical manifests (wrapper-insensitive)', () => {
    expect(diffManifest({ manifest: remote }, remote)).toEqual([]);
  });
});
