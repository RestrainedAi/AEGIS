'use strict';
// Shared bearer check for the local-mirror and maintenance token routes.
// The env var may hold one SHA-256 hex digest or a comma-separated list, so a new
// client secret can be added alongside the old one during rotation.
const { createHash, timingSafeEqual } = require('node:crypto');

function configuredHashes(envValue) {
  return String(envValue || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-f0-9]{64}$/.test(h));
}

// Returns null when not configured, otherwise true/false.
function bearerMatches(authorization, envValue) {
  const hashes = configuredHashes(envValue);
  if (!hashes.length) return null;
  const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization);
  const supplied = createHash('sha256').update(match ? match[1] : '').digest();
  let ok = false;
  for (const h of hashes) {
    if (timingSafeEqual(supplied, Buffer.from(h, 'hex'))) ok = true;
  }
  return Boolean(match) && ok;
}

// Small fixed-window limiter per client IP for the token routes.
function createRateLimiter({ windowMs = 60000, max = 20, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const ip = String((req.headers && req.headers['x-forwarded-for']) || req.ip || '').split(',')[0].trim() || 'unknown';
    const t = now();
    const entry = hits.get(ip);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(ip, { start: t, count: 1 });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        res.set('Retry-After', String(Math.ceil((entry.start + windowMs - t) / 1000)));
        return res.status(429).json({ error: 'Too many requests.' });
      }
    }
    if (hits.size > 5000) hits.clear();
    return next();
  };
}

module.exports = { configuredHashes, bearerMatches, createRateLimiter };
