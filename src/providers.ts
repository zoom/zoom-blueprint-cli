// Labels and configuration for explicit template integrations.

export type ProviderId = 'anthropic' | 'openai';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** The env var that holds the API key. */
  keyEnv: string;
  /** A placeholder shown in .env.example (never a real key). */
  keyPlaceholder: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keyEnv: 'ANTHROPIC_API_KEY',
    keyPlaceholder: 'sk-ant-...',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    keyPlaceholder: 'sk-...',
  },
};

export function getProvider(id: ProviderId): ProviderConfig {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown AI provider "${id}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  return p;
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
