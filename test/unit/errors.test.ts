import { describe, it, expect } from 'vitest';
import { redactSecrets, formatError } from '../../src/util/errors.js';

describe('redactSecrets', () => {
  it('masks bearer tokens, api keys, and bare JWTs', () => {
    expect(redactSecrets('Authorization: Bearer abc.def.ghi123')).toContain('***REDACTED***');
    expect(redactSecrets('{"api_key":"sk-12345"}')).toContain('***REDACTED***');
    expect(redactSecrets('eyJhbGciOi.eyJzdWIiOiI.SflKxwRJSM')).toContain('***REDACTED-JWT***');
  });

  it('masks a client_secret field', () => {
    const out = redactSecrets('client_secret=supersecretvalue');
    expect(out).not.toContain('supersecretvalue');
  });
});

describe('formatError', () => {
  it('renders an HTTP error with advice and redacts the body', () => {
    const err = Object.assign(new Error('boom'), { status: 401, body: { api_key: 'sk-leak' } });
    const out = formatError(err, 'Create App');
    expect(out).toContain('HTTP 401');
    expect(out).not.toContain('sk-leak');
  });

  it('renders a friendly network error without a status', () => {
    const out = formatError(new Error('fetch failed'), 'token');
    expect(out).toContain('Network error');
  });

  it('surfaces the Zoom reason and a public OAuth hint for an unsupported_grant_type error', () => {
    const err = Object.assign(new Error('Zoom OAuth token request failed'), {
      status: 400,
      body: { reason: "The application doesn't support account_credential", error: 'unsupported_grant_type' },
      zoomError: { message: "The application doesn't support account_credential; unsupported_grant_type" },
    });
    const out = formatError(err, 'Create App');
    expect(out).toContain("doesn't support account_credential");
    expect(out).toContain('public-client OAuth');
    expect(out).not.toContain('invalid manifest field'); // no longer misleads
  });
});

it('redacts Basic authorization and credential-bearing URLs while preserving the destination', () => {
  const encoded = Buffer.from('client:fake-test-secret').toString('base64');
  const output = redactSecrets(`Authorization: Basic ${encoded}; https://user:fake-password@example.com/auth?code=fake-oauth-code&state=public-state`);
  expect(output).not.toContain(encoded);
  expect(output).not.toContain('fake-password');
  expect(output).not.toContain('fake-oauth-code');
  expect(output).toContain('example.com/auth');
  expect(output).toContain('state=public-state');
});
it('redacts complete quoted secret values including spaces and escaped quotes', () => {
  const output = redactSecrets({ client_secret: 'fake secret with spaces', password: 'fake "quoted" password' });
  expect(output).not.toContain('with spaces');
  expect(output).not.toContain('quoted');
  expect(output).toContain('***REDACTED***');
});
