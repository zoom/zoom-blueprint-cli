// Shared Upstash Redis client (REST-based, serverless-friendly).
//
// The client is created lazily on first use so that it reads the environment
// variables AFTER dotenv has populated them — importing this module never
// touches process.env at load time.
//
// For local development, Upstash is OPTIONAL: when its URL/token are absent or
// still placeholders, we fall back to an in-memory client implementing the same
// interface (get/set/setex/del/incr/expire/exists) with TTL support. This keeps
// the security semantics identical (idempotency keys, OAuth state, sessions all
// still expire on schedule) while removing the hard dependency on a real DB for
// the minimal chatbot path. It is NOT suitable for production (not shared across
// restarts or instances), so a one-line warning is logged.

import { Redis } from '@upstash/redis';
import { isPlaceholder } from '../services/zoom/webhook-validation.js';

let client = null;

/**
 * An in-memory stand-in for the subset of the Upstash Redis API this app uses.
 * Backed by a Map with per-key expiry. Values are stored by reference in-process
 * (no JSON serialization), mirroring @upstash/redis's object-in/object-out shape.
 */
class InMemoryRedis {
  constructor() {
    /** @type {Map<string, { value: any, expiresAt: number | null }>} */
    this._store = new Map();
  }

  // Returns the live entry if present and not expired, lazily evicting on expiry.
  _entry(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this._store.delete(key);
      return null;
    }
    return entry;
  }

  _ttlMsFromOpts(opts) {
    if (!opts) return null;
    if (typeof opts.ex === 'number') return opts.ex * 1000;      // seconds
    if (typeof opts.px === 'number') return opts.px;             // milliseconds
    return null;
  }

  async get(key) {
    const entry = this._entry(key);
    return entry ? entry.value : null;
  }

  // Mirrors Upstash: supports { nx, ex, px }. With nx, returns 'OK' when the key
  // was newly set and null when it already existed (used for idempotency / SET NX).
  async set(key, value, opts) {
    const exists = this._entry(key) !== null;
    if (opts?.nx && exists) return null;
    if (opts?.xx && !exists) return null;

    const ttlMs = this._ttlMsFromOpts(opts);
    this._store.set(key, {
      value,
      expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
    });
    return 'OK';
  }

  async setex(key, seconds, value) {
    this._store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this._store.delete(key)) count += 1;
    }
    return count;
  }

  async incr(key) {
    const entry = this._entry(key);
    const current = entry ? Number(entry.value) : 0;
    const next = (Number.isFinite(current) ? current : 0) + 1;
    this._store.set(key, { value: next, expiresAt: entry ? entry.expiresAt : null });
    return next;
  }

  // Set/refresh a key's TTL. Returns 1 if applied, 0 if the key is missing.
  async expire(key, seconds) {
    const entry = this._entry(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async exists(...keys) {
    let count = 0;
    for (const key of keys.flat()) {
      if (this._entry(key) !== null) count += 1;
    }
    return count;
  }
}

/**
 * Return the singleton Redis client, creating it on first call.
 *
 * Uses the real Upstash client when valid credentials are present; otherwise
 * returns an in-memory fallback with identical semantics for local development.
 * @returns {import('@upstash/redis').Redis | InMemoryRedis}
 */
export function getRedis() {
  if (client) return client;

  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;

  if (isPlaceholder(UPSTASH_REDIS_REST_URL) || isPlaceholder(UPSTASH_REDIS_REST_TOKEN)) {
    console.warn(
      'Using in-memory store (no Upstash configured) — state is not shared across restarts; set UPSTASH_REDIS_REST_* for production.'
    );
    client = new InMemoryRedis();
    return client;
  }

  client = new Redis({
    url: UPSTASH_REDIS_REST_URL,
    token: UPSTASH_REDIS_REST_TOKEN,
  });

  return client;
}
