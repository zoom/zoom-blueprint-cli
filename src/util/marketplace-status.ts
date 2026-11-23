import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectState } from '../config/project-state.js';
import { getEnv, marketplaceAppUrl } from '../config/env.js';
import { redactSecrets } from './errors.js';
import { log, renderMarketplaceHelp } from './logger.js';

export interface MarketplaceFailure {
  operation: 'create' | 'sync';
  reason: string;
  issues: { setting?: string; message: string }[];
  recordedAt: string;
}

export function marketplaceFailure(operation: MarketplaceFailure['operation'], error: unknown): MarketplaceFailure {
  const err = error as { message?: string; body?: { errors?: { setting?: string; message?: string }[] }; issues?: { setting?: string; message?: string }[] };
  const reason = redactSecrets(err?.message || String(error));
  const issues = err?.issues || err?.body?.errors || [];
  const legacyField = reason.match(/(\/(?:features|oauth_information|display_information)\/[^:\s]+):\s*(.*)/);
  if (!issues.length && legacyField) issues.push({ setting: legacyField[1], message: legacyField[2] });
  return {
    operation,
    reason,
    issues: issues.map(issue => ({
      setting: issue.setting ? redactSecrets(issue.setting) : undefined,
      message: redactSecrets(issue.message || 'Invalid value'),
    })),
    recordedAt: new Date().toISOString(),
  };
}

/** Older CLI versions kept create errors only in a recovery record beside the invoking directory. */
export async function readMarketplaceFailure(dir: string, state: ProjectState): Promise<MarketplaceFailure | undefined> {
  if (state.marketplaceFailure) return state.marketplaceFailure;
  if (state.appId) return undefined;
  const name = state.projectName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  for (let current = dir;; current = path.dirname(current)) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(current, '.zoom-agent-state', `app-${name}.json`), 'utf8'));
      if (record.status === 'failed' && record.error) return marketplaceFailure('create', new Error(record.error));
    } catch { /* Missing or unreadable legacy records do not block local development. */ }
    if (path.dirname(current) === current) return undefined;
  }
}

/** One actionable status block shared by create, resume, and dev across all templates. */
export function printMarketplaceFailure(state: Pick<ProjectState, 'appId' | 'env' | 'manifestPath'>, failure?: MarketplaceFailure): void {
  log.heading('Marketplace setup needs attention');
  log.warn(state.appId ? 'Marketplace configuration is not verified.' : 'No Marketplace app is linked to this project.');
  if (failure) {
    log.plain(`  ${failure.operation === 'create' ? 'Last create attempt' : 'Last URL sync'}: failed`);
    log.plain('');
    log.plain('  Zoom reported');
    if (failure.issues.length) {
      for (const issue of failure.issues) {
        if (issue.setting) log.plain('    Field: ' + issue.setting);
        log.plain('    ' + issue.message);
      }
    } else log.plain('    ' + failure.reason);
    const detail = failure.reason + ' ' + failure.issues.map(issue => `${issue.setting} ${issue.message}`).join(' ');
    log.plain();
    log.plain('  How to resolve');
    if (/command.*(in use|already|taken)/i.test(detail)) {
      log.plain('    Choose an unused Zoom Chat slash command.');
      log.plain('    Field: features.team_chat_subscription.slash_command.command');
      if (!state.appId) log.plain('    zoom app create repairs the old HITL default command automatically.');
    } else if (/scope/i.test(detail)) {
      log.plain('    Review the rejected scope and its availability for this app and account.');
    } else if (/401|403|credential|permission/i.test(detail)) {
      log.plain('    Check the management credentials and Marketplace permissions in the CLI root .env.');
    } else {
      log.plain('    Correct the field Zoom reported before retrying.');
      log.plain('    For connection errors, check connectivity and the selected Zoom environment.');
    }
  }
  log.plain();
  if (state.appId) {
    log.plain(renderMarketplaceHelp('Open Marketplace app\n    ' + marketplaceAppUrl(getEnv(state.env), state.appId)));
    log.plain();
    log.plain('  Retry and verify');
    log.plain('    zoom dev');
  } else {
    if (state.manifestPath) log.plain(`  Project manifest: ${state.manifestPath}`);
    log.plain('  Create and link an app from this project');
    log.plain('    zoom app create');
    log.plain();
    log.plain('  Already have an app? Link it instead');
    log.plain('    zoom app link --app-id <id>');
  }
  log.plain();
}
