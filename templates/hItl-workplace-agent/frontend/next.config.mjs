/** @type {import('next').NextConfig} */
// Load env vars from the OUTER project root (../.env) so the developer
// maintains a single .env file shared by Express and Next.js. Next.js by
// default only loads frontend/.env*, which would force two duplicate files.
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// override: true makes .env win over any pre-existing shell exports (matches
// the Express server's dotenv config and prevents a stale OPENAI_API_KEY in
// ~/.zshrc from shadowing the current value).
loadEnv({ path: path.resolve(__dirname, '..', '.env'), override: true });

const EXPRESS_ORIGIN = process.env.EXPRESS_ORIGIN || 'http://localhost:4000';

// Public backend origin the browser connects to DIRECTLY for the SSE transcript
// stream in a split deployment (Next.js on Vercel, Express on Render). When set,
// it must appear in connect-src or the browser blocks the EventSource. Its
// wss:// form is added too so a future direct WebSocket to /ws is allowed
// (Vercel rewrites don't proxy WebSocket upgrades — connect straight to the
// backend). Unset locally → same-origin 'self' + the dev proxy cover it.
const BACKEND_ORIGIN = (process.env.NEXT_PUBLIC_BACKEND_ORIGIN || '').replace(/\/+$/, '');
const backendConnectSrc = BACKEND_ORIGIN
  ? ` ${BACKEND_ORIGIN} ${BACKEND_ORIGIN.replace(/^http/, 'ws')}`
  : '';

// CSP matching the existing Express/Helmet policy in server.js so this app can
// be embedded inside the Zoom client (frame-ancestors *.zoom.us) and call the
// Apps SDK. Single line because the browser will reject the header otherwise.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appssdk.zoom.us https://source.zoom.us https://cdn.ngrok.com",
  "style-src 'self' 'unsafe-inline' https://cdn.ngrok.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss: https://zoom.us https://*.zoom.us https://*.ngrok.app https://*.ngrok.io https://*.ngrok-free.app${backendConnectSrc}`,
  "frame-ancestors 'self' https://*.zoom.us",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy',   value: CSP },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
];

// Hosts allowed to load Next.js dev resources (HMR, RSC, etc.). Without this,
// Next.js 16+ blocks cross-origin dev requests and HMR fails when the app is
// served through an ngrok tunnel or embedded in the Zoom App iframe.
//
// We include ngrok wildcards by default so the allowlist survives ngrok URL
// changes. Add extra hosts via NEXT_ALLOWED_DEV_ORIGINS (comma-separated).
function devOrigins() {
  const wildcards = ['*.ngrok.app', '*.ngrok-free.app', '*.ngrok.io'];
  const fromEnv = (process.env.NEXT_ALLOWED_DEV_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  try {
    // PUBLIC_BASE_URL is the canonical public origin; FRONTEND_PUBLIC_URL is a
    // backward-compat alias (see backend/utils/config.js).
    const host = new URL(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_PUBLIC_URL || '').host;
    if (host) fromEnv.push(host);
  } catch { /* ignore — not set or not a URL */ }
  return Array.from(new Set([...wildcards, ...fromEnv]));
}

const nextConfig = {
  // Pin Turbopack's workspace root to frontend/. Without this, Next.js sees the
  // repo's outer package-lock.json (Express backend) AND frontend/package-lock.json
  // and warns that it has to guess which one is the real root. The Next.js
  // app lives in frontend/, so that's the right answer.
  turbopack: { root: __dirname },
  allowedDevOrigins: devOrigins(),
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    // Single-tunnel deployment: Next.js is the public front door. Everything
    // the Zoom platform talks to (webhooks, OAuth, signing) is proxied to the
    // Express backend running locally on EXPRESS_ORIGIN. The UI itself stays
    // on Next.js. One ngrok URL → both UI and backend.
    return [
      { source: '/api/:path*',      destination: `${EXPRESS_ORIGIN}/api/:path*` },
      { source: '/webhooks',         destination: `${EXPRESS_ORIGIN}/webhooks` },
      { source: '/webhooks/:path*',  destination: `${EXPRESS_ORIGIN}/webhooks/:path*` },
      { source: '/auth/:path*',      destination: `${EXPRESS_ORIGIN}/auth/:path*` },
      { source: '/apps/:path*',      destination: `${EXPRESS_ORIGIN}/apps/:path*` },
      { source: '/health',           destination: `${EXPRESS_ORIGIN}/health` },
      // External-browser onboarding page — backend-rendered HTML lives on
      // Express so the Next.js app can stay focused on the dashboard.
      // The post-OAuth deep-link button + sign-out link live on the
      // dashboard itself, so there's no /welcome page to proxy.
      { source: '/install',          destination: `${EXPRESS_ORIGIN}/install` },
    ];
  },
};

export default nextConfig;
