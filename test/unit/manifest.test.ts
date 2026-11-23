import { describe, it, expect } from 'vitest';
import {
  generateGeneralAppManifest,
  validateManifestInputs,
  wrapManifestForCreateApp,
  ensureProducts,
  slugifyAlias,
  clip,
  LIMITS,
} from '../../src/manifest/index.js';

describe('generateGeneralAppManifest', () => {
  it('produces the three top-level manifest keys with a generated alias', () => {
    const m = generateGeneralAppManifest({ displayName: 'Meeting Assistant' });
    expect(Object.keys(m)).toEqual(['display_information', 'oauth_information', 'features']);
    expect(m.display_information.display_name).toBe('Meeting Assistant');
    expect(m.display_information.alias_name).toBe('zoom_agent_meeting_assistant');
    expect(m.oauth_information.usage).toBe('USER_OPERATION');
  });

  it('omits the MCP connect block unless an mcp input is supplied', () => {
    const plain = generateGeneralAppManifest({ displayName: 'Plain' });
    expect(plain.features.connect).toBeUndefined();

    const withMcp = generateGeneralAppManifest({ displayName: 'Mcp', mcp: { url: 'https://x/mcp' } });
    expect(withMcp.features.connect.mcp.base_url).toBe('https://x/mcp');
  });

  it('keeps products empty by default and injects when provided', () => {
    const m = generateGeneralAppManifest({ displayName: 'AIC', products: ['ZOOM_AIC', 'ZOOM_VIRTUAL_AGENT'] });
    expect(m.features.products).toEqual(['ZOOM_AIC', 'ZOOM_VIRTUAL_AGENT']);
    const bare = generateGeneralAppManifest({ displayName: 'Bare' });
    expect(bare.features.products).toEqual([]);
  });

  it('throws on missing displayName or invalid usage', () => {
    expect(() => generateGeneralAppManifest({ displayName: '' })).toThrow();
    // @ts-expect-error — testing a bad usage value at runtime
    expect(() => generateGeneralAppManifest({ displayName: 'X', usage: 'BOGUS' })).toThrow();
  });

  it('clips over-length free text to the documented limits', () => {
    const long = 'a'.repeat(300);
    const m = generateGeneralAppManifest({ displayName: 'X', description: long });
    expect(m.display_information.description.length).toBeLessThanOrEqual(LIMITS.description);
  });
});

describe('validateManifestInputs', () => {
  it('flags a missing display name and an over-length description', () => {
    expect(validateManifestInputs({})).toContain('displayName is required.');
    const issues = validateManifestInputs({ displayName: 'X', description: 'a'.repeat(200) });
    expect(issues.some((i) => i.includes('description'))).toBe(true);
  });

  it('passes a clean input set', () => {
    expect(validateManifestInputs({ displayName: 'Good App', description: 'short' })).toEqual([]);
  });

  it('rejects a malformed alias_name', () => {
    expect(validateManifestInputs({ displayName: 'X', aliasName: 'Bad Alias' }).length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('wrapManifestForCreateApp wraps once and is idempotent', () => {
    const m = generateGeneralAppManifest({ displayName: 'X' });
    const wrapped = wrapManifestForCreateApp(m);
    expect(wrapped.manifest).toBe(m);
    expect(wrapManifestForCreateApp(wrapped)).toBe(wrapped);
  });

  it('ensureProducts merges idempotently and dedups', () => {
    const m = generateGeneralAppManifest({ displayName: 'X', products: ['ZOOM_AIC'] });
    ensureProducts(m, ['ZOOM_AIC', 'ZOOM_VIRTUAL_AGENT']);
    ensureProducts(m, ['ZOOM_VIRTUAL_AGENT']);
    expect(m.features.products).toEqual(['ZOOM_AIC', 'ZOOM_VIRTUAL_AGENT']);
  });

  it('slugifyAlias + clip behave', () => {
    expect(slugifyAlias('My 9 App!')).toBe('zoom_agent_my_9_app');
    expect(clip('abcdef', 4)).toHaveLength(4);
    expect(clip('abc', 10)).toBe('abc');
  });
});
