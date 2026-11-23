import { describe, it, expect } from 'vitest';
import { validateProjectName, validateEmail } from '../../src/util/validate.js';

describe('validateProjectName', () => {
  it('accepts a clean kebab-case name', () => {
    expect(validateProjectName('meeting-assistant').ok).toBe(true);
  });

  it('rejects empty, uppercase, spaces, leading digit/dot, and reserved names', () => {
    expect(validateProjectName('').ok).toBe(false);
    expect(validateProjectName('Meeting').ok).toBe(false);
    expect(validateProjectName('my agent').ok).toBe(false);
    expect(validateProjectName('1agent').ok).toBe(false);
    expect(validateProjectName('.agent').ok).toBe(false);
    expect(validateProjectName('_agent').ok).toBe(false);
    expect(validateProjectName('node_modules').ok).toBe(false);
  });

  it('returns a helpful message on failure', () => {
    const r = validateProjectName('My App');
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });
});

describe('validateEmail', () => {
  it('accepts a valid address and rejects garbage', () => {
    expect(validateEmail('dev@example.com').ok).toBe(true);
    expect(validateEmail('nope').ok).toBe(false);
    expect(validateEmail('').ok).toBe(false);
  });
});
