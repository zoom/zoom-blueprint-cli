import { select } from '@inquirer/prompts';
import { log, zoomTheme } from '../util/logger.js';
import { renderUrls, type UrlRow } from '../util/urls.js';

export async function chooseSync(rows: UrlRow[], signal?: AbortSignal): Promise<boolean> {
  if (!process.stdin.isTTY) {
    log.dim('  Sync skipped in noninteractive mode. Run zoom dev --yes to approve changes.');
    return false;
  }
  for (;;) {
    log.plain();
    let action: string;
    try {
      action = await select({
        message: 'Marketplace',
        theme: zoomTheme,
        choices: [
          { name: 'Apply changes', value: 'apply' },
          { name: 'Review all URLs', value: 'review' },
          { name: 'Skip for now', value: 'skip' },
        ],
      }, { signal });
    } finally { log.plain(); }
    if (action === 'apply') return true;
    if (action === 'skip') return false;
    log.heading('Marketplace · complete URL configuration');
    for (const line of renderUrls(rows)) log.plain(line);
  }
}
