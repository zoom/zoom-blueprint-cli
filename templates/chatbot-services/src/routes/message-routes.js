import express from 'express';
import { sendChatMessage, buildTextContent } from '../services/zoom/chatbot-api.js';
import { validateMessagePayload, createValidationMiddleware, sanitizeMessage } from '../services/zoom/webhook-validation.js';

const router = express.Router();

/**
 * POST /api/message
 * Sends a plain-text message to a Zoom Chat channel or user.
 * Include `reply_to` in the body to post as a threaded reply.
 */
router.post('/message', createValidationMiddleware(validateMessagePayload), async (req, res) => {
  try {
    const { to_jid, message, reply_to, user_jid } = req.body;

    const sanitizedMessage = sanitizeMessage(message);
    // Pass user_jid for channel sends (the acting user); defaults to to_jid for DMs.
    const result = await sendChatMessage(to_jid, buildTextContent(sanitizedMessage), reply_to || null, user_jid || null);

    return res.status(200).json({ success: true, message: 'Message sent successfully!', data: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message,
    });
  }
});

export default router;
