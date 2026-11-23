// Shared types for the collected wizard configuration.

import type { AppType } from './templates/registry.js';
import type { ProviderId } from './providers.js';

export interface AppInfo {
  appName: string;
  description: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
}

export interface AgentConfig {
  projectName: string;
  appType: AppType;
  provider?: ProviderId;
  templateId: string;
  info: AppInfo;
  /** Whether to attempt live Marketplace creation (General App only). */
  createApp: boolean;
  /** Provider API key, collected but NEVER logged. Empty string means "developer will add later". */
  providerApiKey: string;
}

export interface CliFlags {
  verbose?: boolean;
  name?: string;
  appType?: AppType;
  provider?: ProviderId;
  template?: string;
  outDir?: string;
  env?: string;
  yes?: boolean;
  create?: boolean; // commander maps --no-create → create:false
  /** Opt into the Claude Code customization step (generate docs + git branch). */
  claudeCode?: boolean;
  /** Development branch name for the Claude Code step. */
  branch?: string;
}
