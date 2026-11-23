// Interactive project setup. Each prompt accepts an
// optional pre-seeded value from a CLI flag so the whole flow is scriptable (flag/prompt parity).

import { input, select, confirm, password } from '@inquirer/prompts';
import { validateProjectName, validateEmail, required } from './util/validate.js';
import { PROVIDERS, type ProviderId } from './providers.js';
import { compatibleTemplates, type AppType, type Template } from './templates/registry.js';
import type { AppInfo } from './types.js';

export async function promptProjectName(preset?: string): Promise<string> {
  if (preset) {
    const r = validateProjectName(preset);
    if (!r.ok) throw new Error(`Invalid --name "${preset}": ${r.message}`);
    return preset;
  }
  return input({
    message: 'What is your agent project name?',
    default: 'meeting-assistant',
    validate: (v) => {
      const r = validateProjectName(v);
      return r.ok || r.message || 'Invalid name.';
    },
  });
}

export async function promptAppType(preset?: AppType): Promise<AppType> {
  if (preset && preset !== 'general') throw new Error('Only General Apps are supported. Use --app-type general.');
  return 'general';
}

export async function promptTemplate(appType: AppType, provider: ProviderId | undefined, preset?: string): Promise<Template> {
  const choices = compatibleTemplates(appType, provider);
  if (choices.length === 0) {
    throw new Error(
      `No template supports a ${appType} app with ${provider ? PROVIDERS[provider].label : 'its AI integrations'}. Try a different combination.`,
    );
  }
  if (preset) {
    const match = choices.find((t) => t.id === preset);
    if (!match) {
      throw new Error(
        `Template "${preset}" is not compatible with a ${appType} app + ${provider ? PROVIDERS[provider].label : 'its AI integrations'}. ` +
          `Compatible: ${choices.map((t) => t.id).join(', ')}`,
      );
    }
    return match;
  }
  const id = await select<string>({
    message: 'Choose a starter template',
    choices: choices.map((t) => ({ name: t.name, value: t.id, description: t.description })),
  });
  return choices.find((t) => t.id === id)!;
}

export async function promptAppInfo(defaults: Partial<AppInfo>): Promise<AppInfo> {
  const appName = await input({
    message: 'App name (shown in the Zoom Marketplace)',
    default: defaults.appName,
    validate: (v) => required('App name')(v).ok || 'App name is required.',
  });
  const description = await input({
    message: 'Short description',
    default: defaults.description || `${appName} — an AI agent for Zoom Workplace.`,
  });
  const contactName = await input({
    message: 'Developer / contact name',
    default: defaults.contactName,
    validate: (v) => required('Contact name')(v).ok || 'Contact name is required.',
  });
  const contactEmail = await input({
    message: 'Contact email',
    default: defaults.contactEmail,
    validate: (v) => {
      const r = validateEmail(v);
      return r.ok || r.message || 'Invalid email.';
    },
  });
  const companyName = await input({
    message: 'Company name',
    default: defaults.companyName || contactName,
    validate: (v) => required('Company name')(v).ok || 'Company name is required.',
  });
  return { appName, description, contactName, contactEmail, companyName };
}

/**
 * Prompt for the provider API key. Uses a masked input so it never echoes to the terminal, and
 * returns '' when the developer chooses to add it later.
 */
export async function promptProviderApiKey(provider: ProviderId): Promise<string> {
  const p = PROVIDERS[provider];
  const provideNow = await confirm({
    message: `Enter your ${p.label} API key now? (stored only in the project's .env, never printed)`,
    default: false,
  });
  if (!provideNow) return '';
  return password({
    message: `${p.keyEnv} (input hidden)`,
    mask: true,
  });
}

export async function promptConfirmCreate(message: string): Promise<boolean> {
  return confirm({ message, default: true });
}
