// Input validators shared by prompts, flags, and tests.

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

const RESERVED = new Set(['node_modules', 'favicon.ico', '.', '..']);

/**
 * Validate an agent project name. It becomes both a directory name and the generated package name,
 * so we enforce a safe, npm-compatible subset.
 */
export function validateProjectName(name: string): ValidationResult {
  const n = (name || '').trim();
  if (!n) return { ok: false, message: 'Project name is required.' };
  if (n.length > 214) return { ok: false, message: 'Project name must be 214 characters or fewer.' };
  if (RESERVED.has(n.toLowerCase())) return { ok: false, message: `"${n}" is a reserved name.` };
  if (n !== n.toLowerCase()) return { ok: false, message: 'Project name must be lowercase.' };
  if (/^[._]/.test(n)) return { ok: false, message: 'Project name may not start with a dot or underscore.' };
  if (!/^[a-z0-9-]+$/.test(n)) {
    return { ok: false, message: 'Use only lowercase letters, digits, and hyphens (e.g. meeting-assistant).' };
  }
  if (!/^[a-z]/.test(n)) return { ok: false, message: 'Project name must start with a letter.' };
  return { ok: true };
}

/** Basic email shape check (not RFC-exhaustive — just enough to catch typos before an API call). */
export function validateEmail(email: string): ValidationResult {
  const e = (email || '').trim();
  if (!e) return { ok: false, message: 'Contact email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, message: 'Enter a valid email address.' };
  return { ok: true };
}

/** Require a non-empty trimmed string. */
export function required(label: string) {
  return (value: string): ValidationResult => {
    if (!value || !value.trim()) return { ok: false, message: `${label} is required.` };
    return { ok: true };
  };
}
