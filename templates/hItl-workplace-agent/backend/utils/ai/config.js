// Credentials are checked locally for presence and placeholders.
// Actual account and model access is established only by a provider request.
export function isProviderKeyConfigured(value, provider) {
  if (!value || /^(your[_-]|change-this|changeme|placeholder|todo|xxx)/i.test(value.trim())) return false;
  if (/\s|\.\.\.|\{\{/.test(value)) return false;
  return provider === 'anthropic' ? value.startsWith('sk-ant-') : true;
}

export function isClaudeConfigured() {
  return isProviderKeyConfigured(process.env.ANTHROPIC_API_KEY, 'anthropic');
}

export const CLAUDE_SETUP_MESSAGE =
  'Claude research replies are disabled. Add ANTHROPIC_API_KEY to .env and restart to enable them.';
