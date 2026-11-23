// Tiny terminal output helpers. Keeps chalk usage consistent across the CLI.
import chalk from 'chalk';

export const zoomBlue = chalk.hex('#0B5CFF');
export const zoomTheme = { prefix: zoomBlue('›'), style: { highlight: zoomBlue, answer: zoomBlue } };

export const log = {
  header: (project: string): void => console.log('\n' + zoomBlue(`◆ Zoom CLI / ${project}`) + '\n'),
  plain: (msg = ''): void => console.log(msg),
  info: (msg: string): void => console.log(msg),
  dim: (msg: string): void => console.log(chalk.dim(msg)),
  success: (msg: string): void => console.log(chalk.green(`✔ ${msg}`)),
  warn: (msg: string): void => console.log(chalk.yellow(`! ${msg}`)),
  error: (msg: string): void => console.error(chalk.red(`✖ ${msg}`)),
  step: (msg: string): void => console.log(chalk.cyan(`› ${msg}`)),
  heading: (msg: string): void => console.log('\n' + chalk.bold(msg)),
};

export { chalk };

/** Keep plain URLs in redirected output and terminals without known hyperlink support. */
export function renderMarketplaceHelp(help: string): string {
  const supported = ['iTerm.app', 'WezTerm', 'vscode'].includes(process.env.TERM_PROGRAM ?? '');
  return help.replace(
    /^(Open Marketplace (surface|access|app))\n +((?:https:\/\/)[^\s\x00-\x1f]+)$/gm,
    (_, _label: string, page: string, url: string) => {
      const label = zoomBlue('↗') + ' Open Marketplace' + (page === 'app' ? '' : ` · ${page === 'surface' ? 'Surface' : 'Access'}`);
      return process.stdout.isTTY && supported
        ? `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`
        : `${label}\n    ${url}`;
    },
  );
}

export interface RenderDiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  local?: string;
  remote?: string;
}

/**
 * Render manifest diff entries as a readable per-field before/after block (git-style), instead of a
 * jumbled inline `a → b`. Full values are preserved. Returns lines to print.
 */
export function renderDiff(entries: RenderDiffEntry[], indent = '    '): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(indent + chalk.bold(e.path));
    if (e.type !== 'added' && e.remote !== undefined) lines.push(indent + '  ' + chalk.red(`− ${e.remote}`));
    if (e.type !== 'removed' && e.local !== undefined) lines.push(indent + '  ' + chalk.green(`+ ${e.local}`));
  }
  return lines;
}
