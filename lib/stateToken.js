const crypto = require('crypto');

/**
 * Stateless, server-signed state tokens.
 *
 * PalmPyaar has no database and no user accounts, so payment/reading state
 * cannot be stored server-side. Instead, /api/create-payment signs a short-lived
 * state token binding the EXACT reading payload to the generated Razorpay order.
 * /api/verify-razorpay verifies this token and reads the reading data ONLY from
 * it, so a paid order can never be replayed against modified reading data.
 *
 * Format:
 *   <base64url(JSON payload)>.<hex HMAC-SHA256>
 *   HMAC key  = TOKEN_SECRET (server-side only)
 *   HMAC msg  = DOMAIN + "." + base64url(payload)   (domain-separated so the
 *               signature can never collide with the reading-token HMAC that
 *               /api/generate-reading recomputes)
 *
 * The payload carries: v, razorpayOrderId, name, dob, birthplace, tradition,
 * photoHash, orderId, amount, amountPaise, currency, iat, exp.
 *
 * Verification is constant-time and rejects: malformed tokens, bad signatures,
 * and expired tokens.
 */

const TTL_SECONDS = 30 * 60; // 30 minutes — a stale/unpaid checkout expires fast.
const DOMAIN = 'palmpyaar-state-token-v1';

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(body) {
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

function sign(payload, secret) {
  const body = encode(payload);
  const sig = crypto.createHmac('sha256', String(secret))
    .update(DOMAIN + '.' + body)
    .digest('hex');
  return body + '.' + sig;
}

/**
 * Verifies the token and returns the payload, or null when the token is
 * malformed, forged, or expired.
 */
function verify(token, secret, opts) {
  const nowSeconds = opts && Number.isFinite(opts.now) ? Math.floor(opts.now) : Math.floor(Date.now() / 1000);
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;

  const idx = token.lastIndexOf('.');
  if (idx <= 0 || idx === token.length - 1) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;

  const expected = crypto.createHmac('sha256', secret)
    .update(DOMAIN + '.' + body)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = decode(body);
  } catch (err) {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= nowSeconds) return null;

  return payload;
}

module.exports = { sign, verify, TTL_SECONDS, DOMAIN };
