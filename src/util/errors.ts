// Human-readable CLI errors with secret-shaped values removed before display.

import chalk from 'chalk';

const SECRET_KEY_RE =
  /("?(?:code_verifier|refresh_token|access_token|api[_-]?key|apikey|x-api-key|generic_api_key|token|jwt|zccsToken|password|secret|authorization|client_secret)"?\s*[:=]\s*"?)([^"\s,}&]+)/gi;
const QUOTED_SECRET_RE =
  /("?(?:code_verifier|refresh_token|access_token|api[_-]?key|apikey|x-api-key|generic_api_key|token|jwt|zccsToken|password|secret|authorization|client_secret)"?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi;
const BASIC_AUTH_RE = /(Basic\s+)[A-Za-z0-9+/]+={0,2}/gi;
const URL_USERINFO_RE = /(https?:\/\/)[^/\s@]+@/gi;
const OAUTH_CODE_RE = /([?&](?:code|client_assertion|id_token)=)[^&#\s"']+/gi;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const JWT_RE = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

/** Mask secret-shaped substrings. Accepts a string or any JSON-serializable value. */
export function redactSecrets(input: unknown): string {
  if (input == null) return '';
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  s = s.replace(BASIC_AUTH_RE, '$1***REDACTED***');
  s = s.replace(URL_USERINFO_RE, '$1***REDACTED***@');
  s = s.replace(OAUTH_CODE_RE, '$1***REDACTED***');
  s = s.replace(BEARER_RE, '$1***REDACTED***');
  s = s.replace(QUOTED_SECRET_RE, '$1"***REDACTED***"');
  s = s.replace(SECRET_KEY_RE, '$1***REDACTED***');
  s = s.replace(JWT_RE, '***REDACTED-JWT***');
  return s;
}

const GENERIC: Record<number, string> = {
  400: 'Bad request. Zoom rejected the credentials or the manifest — see the reason above.',
  401: 'Authentication failed. The Zoom credential you used was rejected.',
  403: 'Forbidden. Your credential is valid but lacks permission to manage Marketplace apps.',
  404: 'Not found. The endpoint or resource id is wrong, or you are on the wrong environment.',
  409: 'Conflict. A name or alias collides with an existing app.',
  429: 'Rate limited by Zoom. Wait a few seconds and retry.',
};

// Targeted, actionable guidance for well-known Zoom failures (more useful than the generic table).
function specificHint(err: HttpishError): string {
  const text = [err.zoomError?.message, err.message, safeStringify(err.body)].filter(Boolean).join(' ').toLowerCase();
  if (/unsupported_grant_type/.test(text)) {
    return chalk.dim('Enable public-client OAuth on the CLI General App, check ZOOM_PUBLIC_CLIENT_ID in the CLI .env, then run zoom login.');
  }
  if (err.status === 401) {
    return chalk.dim('Run zoom login to renew public OAuth.');
  }
  if (err.status === 403) {
    return chalk.dim('Check Marketplace management scopes and the authorizing user’s account permissions.');
  }
  return '';
}

function safeStringify(v: unknown): string {
  if (v == null) return '';
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '';
  }
}

interface HttpishError extends Error {
  status?: number;
  body?: unknown;
  zoomError?: { code?: number; message?: string };
}

/** Human-friendly, secret-safe rendering of an error for terminal output. */
export function formatError(err: unknown, context = ''): string {
  const e = err as HttpishError | undefined;

  // Inquirer Ctrl-C.
  if (e?.name === 'ExitPromptError') return chalk.yellow('Cancelled.');

  // Network-level errors carry no HTTP status.
  if (!e?.status) {
    const m = e?.message || String(err);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(m)) {
      return (
        chalk.red(`Network error${context ? ` during ${context}` : ''}.`) +
        '\n  ' +
        chalk.dim('Likely cause: no connectivity, VPN/proxy down, or the Zoom host is unreachable.') +
        '\n  ' +
        chalk.dim('Next step: confirm you can reach the host in a browser, then retry.')
      );
    }
    return chalk.red(redactSecrets(m));
  }

  const status = e.status;
  let out = chalk.red(`${context || 'API call'} failed (HTTP ${status})`);

  // The parsed Zoom reason (e.g. "The application doesn't support account_credential") is the most
  // useful line — show it before the generic advice.
  const reason = e.zoomError?.message ? redactSecrets(String(e.zoomError.message)) : '';
  if (reason) out += '\n  ' + reason;

  const advice = GENERIC[status];
  if (advice) out += '\n  ' + chalk.dim(advice);

  const hint = specificHint(e);
  if (hint) out += '\n  ' + hint;

  if (status >= 500) {
    out += '\n  ' + chalk.dim('Server-side error. Retrying often works.');
  }
  if (!reason && e.body) {
    const body = redactSecrets(e.body);
    out += '\n  ' + chalk.dim(`Body: ${body.slice(0, 280)}${body.length > 280 ? '…' : ''}`);
  }
  return out;
}

/** True when the error is an Inquirer cancellation (Ctrl-C at a prompt). */
export function isCancel(err: unknown): boolean {
  return (err as Error | undefined)?.name === 'ExitPromptError';
}

/** A small typed error for user-facing CLI failures (bad input, missing prerequisites). */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
