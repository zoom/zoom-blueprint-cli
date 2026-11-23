import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

import oauthRoutes from '../routes/oauth-routes.js';
import webhookRoutes from '../routes/webhook-routes.js';
import messageRoutes from '../routes/message-routes.js';
import signRoutes from '../routes/signature-routes.js';

import { validateEnvironmentVariables } from '../services/zoom/webhook-validation.js';
import { CLAUDE_SETUP_MESSAGE, isClaudeConfigured } from '../services/ai/anthropic-client.js';
import { UpstashSessionStore } from '../utils/session-store.js';

// Load environment variables
dotenv.config();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Validate required environment variables on startup
const envValidation = validateEnvironmentVariables();
if (!envValidation.isValid) {
  console.error('❌ Environment validation failed:');
  envValidation.errors.forEach(error => console.error(`  - ${error}`));
  process.exit(1);
}

if (!isClaudeConfigured()) console.warn(CLAUDE_SETUP_MESSAGE);

// In production, refuse to start without a real session secret (no dev fallback).
if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET must be set in production.');
  process.exit(1);
}

// Surface a warning if running outside production — error responses will include
// internal details and cookies will not be marked secure.
if (!IS_PRODUCTION) {
  console.warn('⚠️  NODE_ENV is not "production" — verbose errors and non-secure cookies are enabled.');
}

const app = express();

app.set('trust proxy', 1);

// Middleware
app.use(cors({ 
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Increase payload limit for webhooks. The `verify` callback stashes the raw
// request bytes on req.rawBody so webhook signature verification can HMAC over
// exactly what Zoom sent (re-serializing the parsed body can differ byte-for-byte).
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://appssdk.zoom.us",
        "https://source.zoom.us",
        "https://cdn.ngrok.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.ngrok.com"],
      imgSrc:   ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'", "wss:",
        "https://zoom.us", "https://*.zoom.us",
        "https://*.ngrok.app", "https://*.ngrok-free.app", "https://*.ngrok.io"
      ],
      frameAncestors: ["'self'", "https://*.zoom.us"], 
    },
  },
}));

// Request logging middleware
app.use((req, _res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Sessions (for CSRF state), backed by Redis via a custom Upstash store.
// Secure cookies are enabled in production; local dev over http keeps them off.
app.use(session({
  store: new UpstashSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false, // only persist sessions that actually store something (e.g. oauth_state)
  cookie: {
    secure: IS_PRODUCTION,   // require HTTPS for the cookie in production
    httpOnly: true,          // not readable from client-side JS
    sameSite: 'lax',         // sufficient for the top-level OAuth redirect flow
  },
}));

// Serve static files from views directory
app.use(express.static('public'));

// Routes
app.use('/api', messageRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/auth', oauthRoutes);
app.use('/apps', signRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'zoom-team-chatbot',
    version: '1.0.0'
  });
});



// View routes
app.get('/success', (_req, res) => {
  res.sendFile('success.html', { root: 'public' });
});

app.get('/webview', (_req, res) => {
  res.sendFile('webview.html', { root: 'public' });
});

app.get('/', (_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Error handling middleware
app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// Public, non-sensitive client config
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store'); // avoid stale env leakage in dev

  const config = {
    // JID is effectively public; do NOT put secrets here.
    ZOOM_BOT_JID: process.env.ZOOM_BOT_JID || '',
  };

  // Only serialize the whitelisted keys
  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`🚀 Zoom Chat Chatbot API listening on port ${port}`);
  console.log(`📋 Health check: http://localhost:${port}/health`);
  console.log(`🔗 Webhook endpoint: http://localhost:${port}/webhooks`);
});
