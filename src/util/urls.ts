import { redactSecrets } from './errors.js';
import { getPath, innerManifest } from '../manifest/resolve.js';
import type { ZoomManifest } from '../manifest/index.js';
import type { UrlMapping } from '../manifest/resolve.js';

export interface UrlRow { label: string; current: string; proposed: string; }

/** Values come from the fetched Marketplace manifest, never inferred from a shared hostname. */
export function urlRows(remote: ZoomManifest, proposed: ZoomManifest, mappings: UrlMapping[]): UrlRow[] {
  const rows = mappings.map(mapping => ({
    label: mapping.label || mapping.path,
    current: String(getPath(innerManifest(remote), mapping.path) ?? '(unset)'),
    proposed: String(getPath(innerManifest(proposed), mapping.path) ?? '(unset)'),
  }));
  const seen = new Set(mappings.map(mapping => mapping.path));
  const paths = new Set<string>();
  const discover = (value: unknown, prefix = '') => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) paths.add(prefix);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) discover(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  discover(innerManifest(remote));
  discover(innerManifest(proposed));
  for (const field of paths) {
    if (seen.has(field)) continue;
    rows.push({ label: field, current: String(getPath(innerManifest(remote), field) ?? '(unset)'), proposed: String(getPath(innerManifest(proposed), field) ?? '(unset)') });
  }
  return rows;
}

/** Preserve complete URLs. Use stacked rows whenever a full table would wrap. */
export function renderUrls(rows: UrlRow[], columns = process.stdout.columns || 80): string[] {
  if (!rows.length) return [];
  const field = Math.max(5, ...rows.map(r => r.label.length));
  const current = Math.max(7, ...rows.map(r => r.current.length));
  const proposed = Math.max(8, ...rows.map(r => r.proposed.length));
  if (field + current + proposed + 8 <= columns) {
    return [
      `  ${'Field'.padEnd(field)}  ${'Current'.padEnd(current)}  Proposed`,
      ...rows.map(r => `  ${r.label.padEnd(field)}  ${r.current.padEnd(current)}  ${r.proposed}`),
    ];
  }
  return rows.flatMap((r, index) => [
    ...(index ? [''] : []), `  ${r.label}`, `    Current:  ${r.current}`, `    Proposed: ${r.proposed}`,
  ]);
}

/** A mismatch is an unverified update, even when Zoom accepted the PUT request. */
export function renderUrlVerification(actual: ZoomManifest, expected: ZoomManifest, mappings: UrlMapping[]): string[] {
  return mappings.flatMap((mapping, index) => [
    ...(index ? [''] : []),
    `  ${mapping.label || mapping.path}`,
    `    Expected: ${redactSecrets(String(getPath(innerManifest(expected), mapping.path) ?? '(unset)'))}`,
    `    Received: ${redactSecrets(String(getPath(innerManifest(actual), mapping.path) ?? '(unset)'))}`,
  ]);
}
