import { it, expect, vi, afterEach } from 'vitest';
import { renderUrls, urlRows } from '../../src/util/urls.js';
import { renderMarketplaceHelp } from '../../src/util/logger.js';
import { printReconcileReport } from '../../src/commands/configure.js';
import { getEnv, marketplaceAppUrl } from '../../src/config/env.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('preserves full, different-host URLs in wide tables and narrow stacked rows', () => {
  const rows = [{ label: 'OAuth callback', current: 'https://oauth.custom.example/auth/callback?continue=' + 'x'.repeat(110), proposed: 'https://new.ngrok.app/auth/callback' }];
  const wide = renderUrls(rows, 250).join('\n');
  expect(wide).toContain('Current'); expect(wide).toContain(rows[0].current); expect(wide).not.toContain('…');
  const narrow = renderUrls(rows, 60).join('\n');
  expect(narrow).toContain('Current:'); expect(narrow).toContain('Proposed:'); expect(narrow).toContain(rows[0].current);
  expect(renderUrls([])).toEqual([]);
});
it('reads URL comparisons from remote values rather than inventing a common host', () => {
  const remote = { features: { home: 'https://frontend.example', webhook: 'https://backend.example/events' } };
  const proposed = { features: { home: 'https://new.example', webhook: remote.features.webhook } };
  const rows = urlRows(remote as any, proposed as any, [{ path: 'features.home', label: 'Home' }, { path: 'features.webhook', label: 'Webhook' }]);
  expect(rows[1].current).toBe('https://backend.example/events');
  expect(rows.filter(row => row.current !== row.proposed)).toHaveLength(1);
});
it('uses consistent external navigation with a full URL fallback', () => {
  vi.stubEnv('TERM_PROGRAM', 'unsupported');
  const url = marketplaceAppUrl(getEnv('prod'), 'APP', 'surface');
  const output = renderMarketplaceHelp('Open Marketplace surface\n  ' + url);
  expect(output).toContain('↗ Open Marketplace · Surface'); expect(output).toContain(url); expect(output).not.toContain('\x1b]8');
});
it('acknowledges automated env changes once and keeps masked variable details in verbose mode', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const result = { envPath: '.env', changes: [{ key: 'SESSION_SECRET', display: '(generated)', action: 'generated' as const, label: 'Session signing secret' }], unresolved: [], wrote: true };
  printReconcileReport(result);
  expect(log.mock.calls.flat().join('\n')).toContain('Environment updated');
  expect(log.mock.calls.flat().join('\n')).not.toContain('SESSION_SECRET');
  log.mockClear(); printReconcileReport(result, true);
  expect(log.mock.calls.flat().join('\n')).toContain('Local .env changes');
  expect(log.mock.calls.flat().join('\n')).toContain('SESSION_SECRET');
  expect(log.mock.calls.flat().join('\n')).toContain('(generated)');
});
