import { log } from './logger.js';

/** Expand only after installation, build and runtime checks pass on another version. */
export const VERIFIED_NODE_VERSION = '22.23.5';

export function warnUnverifiedNode(version = process.versions.node): void {
  if (version === VERIFIED_NODE_VERSION) return;
  log.warn(
    `Node.js ${version} has not been verified with this CLI and its bundled samples.\n` +
    `  Continuing with your current version. The verified version is ${VERIFIED_NODE_VERSION}.\n\n` +
    `  If you encounter compatibility issues, switch with nvm:\n` +
    `    nvm install ${VERIFIED_NODE_VERSION}\n` +
    `    nvm use ${VERIFIED_NODE_VERSION}\n` +
    `    node --version\n\n` +
    `  If nvm is unavailable, use your preferred Node version manager.\n` +
    `  After switching, reinstall the app dependencies before running it.\n`,
  );
}
