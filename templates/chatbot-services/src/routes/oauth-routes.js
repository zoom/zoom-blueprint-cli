import express from 'express';
import crypto from 'crypto';
import { buildOAuthAuthorizationUrl, exchangeCodeForAccessToken } from '../services/zoom/oauth.js';

const router = express.Router();

/**
 * Minimal HTML page for OAuth error responses so users never see a blank/plain
 * body. Success lands on the educational /success page instead.
 */
function renderMessage(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#f4f6fb;color:#1a1a1a;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;max-width:480px;padding:2rem;border-radius:12px;
box-shadow:0 4px 16px rgba(0,0,0,.08);text-align:center}
h1{color:#e02424;font-size:1.25rem;margin:0 0 .5rem}p{color:#555;line-height:1.5}</style>
</head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

// OAuth: start the user-authorization flow.
router.get('/login', (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;

    const url = buildOAuthAuthorizationUrl({
      clientId: process.env.ZOOM_CLIENT_ID,
      redirectUri: process.env.ZOOM_REDIRECT_URI,
      state,
    });

    return res.redirect(url);
  } catch (e) {
    console.error('OAuth login error:', e);
    return res.status(500).send(renderMessage('OAuth not configured', 'Check ZOOM_CLIENT_ID and ZOOM_REDIRECT_URI in your .env.'));
  }
});

// OAuth: callback — Zoom redirects here with an authorization code.
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.warn('Zoom authorization error:', error, error_description);
      return res.status(400).send(renderMessage('Authorization error', `Zoom returned: ${error}`));
    }
    if (!code) {
      return res.status(400).send(renderMessage('Missing authorization code', 'Zoom did not return a "code" parameter.'));
    }

    // CSRF: when WE started the flow (/auth/login), a state was stored in the
    // session and MUST match. On a first-run install initiated from the Zoom
    // Marketplace there is no prior session to compare against — allow it through
    // (Zoom initiated the redirect). This is what fixes the first-run blank page.
    const expectedState = req.session?.oauth_state;
    if (expectedState) {
      if (state !== expectedState) {
        return res.status(400).send(renderMessage('Invalid state', 'The OAuth state did not match. Please try installing again.'));
      }
      delete req.session.oauth_state; // one-time use
    }

    const tokens = await exchangeCodeForAccessToken({
      code,
      redirectUri: process.env.ZOOM_REDIRECT_URI,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
    });

    // Demo only: store tokens in the session. Use a database / secret store in production.
    req.session.zoomTokens = tokens;

    // Land on the educational "you're all set" page.
    return res.redirect('/success');
  } catch (e) {
    console.error('OAuth callback error:', e);
    return res.status(500).send(renderMessage('Token exchange failed', 'Could not complete authentication. Check the server logs.'));
  }
});

export default router;
