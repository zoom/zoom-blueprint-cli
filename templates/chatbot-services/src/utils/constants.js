export const ACTIONS = {
  OPEN_MENU: 'OPEN_MENU',
  OPEN_APP: 'connect', // opens the in-client Zoom App webview via a dialog action
  START_RESEARCH: 'START_RESEARCH',
  START_APPRECIATION: 'START_APPRECIATION',
  RESEARCH_ASK_QUESTION: 'RESEARCH_ASK_QUESTION',
  RESEARCH_SUMMARIZE_THREAD: 'RESEARCH_SUMMARIZE_THREAD',
  RESEARCH_DRAFT_RESPONSE: 'RESEARCH_DRAFT_RESPONSE',
  SUBMIT_APPRECIATION: 'SUBMIT_APPRECIATION',
  CANCEL_APPRECIATION: 'CANCEL_APPRECIATION',
};

export const MENU_TRIGGERS = ['help', 'start', 'menu', 'services'];
export const CANCEL_TRIGGERS = ['cancel', 'stop', 'quit', 'exit'];

// Zoom base URLs. Override for Zoom for Government (ZfG):
//   ZOOM_OAUTH_BASE_URL=https://zoomgov.com
//   ZOOM_API_BASE_URL=https://api.zoomgov.com/v2
// Defaults target the commercial Zoom environment.
export const ZOOM_OAUTH_BASE_URL = process.env.ZOOM_OAUTH_BASE_URL || 'https://zoom.us';
export const ZOOM_API_BASE_URL = process.env.ZOOM_API_BASE_URL || 'https://api.zoom.us/v2';

/**
 * Public URL of the in-client Zoom App webview, used as the dialog link on the
 * "Open App" button. Resolved at call time (not module load) so it reflects env
 * vars loaded by dotenv.
 *
 * Precedence:
 *   1. WEBVIEW_URL (explicit override)
 *   2. origin of ZOOM_REDIRECT_URI + "/webview" (tracks your active tunnel)
 *   3. http://localhost:4000/webview (dev fallback)
 * @returns {string}
 */
export function getWebviewUrl() {
  if (process.env.WEBVIEW_URL) return process.env.WEBVIEW_URL;
  try {
    return `${new URL(process.env.ZOOM_REDIRECT_URI).origin}/webview`;
  } catch {
    return `http://localhost:${process.env.PORT || 4000}/webview`;
  }
}
