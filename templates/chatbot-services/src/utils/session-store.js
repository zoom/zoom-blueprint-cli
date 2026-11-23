// Custom express-session store backed by the shared Upstash Redis client.
//
// Why not connect-redis? connect-redis wraps a node-redis/ioredis TCP client,
// whereas Upstash uses a REST/HTTP client (@upstash/redis). Rather than pull in
// a second Redis library and connection style, we implement express-session's
// small Store interface (get/set/destroy/touch) directly on top of the same
// getRedis() client used everywhere else — one client, one vendor.

import session from 'express-session';
import { getRedis } from './redis.js';

const DEFAULT_PREFIX = 'sess:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 1 day fallback when the cookie has no maxAge

export class UpstashSessionStore extends session.Store {
  constructor({ prefix = DEFAULT_PREFIX, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
    super();
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;
  }

  _key(sid) {
    return `${this.prefix}${sid}`;
  }

  // Prefer the cookie's own maxAge (ms → s); otherwise fall back to the default.
  _ttl(sess) {
    const maxAge = sess?.cookie?.maxAge;
    return typeof maxAge === 'number' ? Math.max(Math.floor(maxAge / 1000), 1) : this.ttlSeconds;
  }

  async get(sid, callback) {
    try {
      // @upstash/redis parses stored JSON automatically, so this is the session object or null.
      const data = await getRedis().get(this._key(sid));
      callback(null, data ?? null);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      await getRedis().set(this._key(sid), sess, { ex: this._ttl(sess) });
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await getRedis().del(this._key(sid));
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  // Called on reads to slide the expiry window without rewriting the payload.
  async touch(sid, sess, callback) {
    try {
      await getRedis().expire(this._key(sid), this._ttl(sess));
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }
}
