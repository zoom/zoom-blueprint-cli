// routes/signature-routes.js
import express from 'express';
import crypto from 'crypto';

const router = express.Router();

/**
 * POST /api/sign
 * Body: { content: <object> }   // the exact object you’ll stringfy in composeCard.message
 *   or: { message: <string> }   // the webview posts this shape
 * Returns: { signature, timestamp }
 */
router.post('/sign', (req, res) => {
  try {
    // Accept both shapes: prefer `content`, fall back to `message` (webview.html).
    const content = req.body?.content ?? req.body?.message;
    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'Missing content' });
    }
    if (!process.env.ZOOM_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Missing ZOOM_CLIENT_SECRET' });
    }

    const timestamp = Date.now().toString();
    // IMPORTANT: sign the raw string you pass into composeCard.message
    const messageToSign = `v0:${timestamp}:${JSON.stringify(content)}`;

    const signature = crypto
      .createHmac('sha256', process.env.ZOOM_CLIENT_SECRET)
      .update(messageToSign)
      .digest('hex');

    return res.json({ signature, timestamp });
  } catch (e) {
    console.error('sign error:', e);
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

export default router;
