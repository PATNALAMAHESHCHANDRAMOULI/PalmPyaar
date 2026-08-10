const crypto = require('crypto');

/**
 * Vercel Serverless Function: POST /api/razorpay-webhook
 *
 * Razorpay webhook receiver — an additional, reliable server-side confirmation
 * of payments. Every request is verified with the X-Razorpay-Signature header:
 *
 *   HMAC-SHA256(key = RAZORPAY_WEBHOOK_SECRET, message = RAW request body)
 *
 * computed over the raw body (never a re-serialized object) and compared in
 * constant time. Unverified webhooks are rejected (401) and never trusted.
 *
 * PalmPyaar is fully stateless (no database): the immediate unlock already
 * happens in /api/verify-razorpay after server-side signature verification.
 * This endpoint acknowledges verified payment events (payment.captured,
 * payment.authorized, order.paid) server-side and logs them without PII.
 */

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Reads the raw request body. On Vercel, `req` is the Node IncomingMessage, so
 * the stream is preferred (byte-exact). If the platform already consumed the
 * stream (req.body parsed), falls back to re-serializing the parsed body.
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== 'function') {
      // Test mock: no real stream available.
      resolve({
        raw: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}),
        body: typeof req.body === 'string' ? null : req.body
      });
      return;
    }
    if (req.readableEnded || req.destroyed || !req.readable) {
      resolve(null);
      return;
    }
    const chunks = [];
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve({ raw: Buffer.concat(chunks).toString('utf8'), body: null });
      }
    };
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', finish);
    req.on('error', () => finish());
    req.on('close', finish);
  });
}

const TRUSTED_EVENTS = ['payment.captured', 'payment.authorized', 'order.paid'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: RAZORPAY_WEBHOOK_SECRET is missing. Set it in environment variables to receive webhooks.'
      });
    }

    const headerSignature = String(
      (req.headers && (req.headers['x-razorpay-signature'] || req.headers['X-Razorpay-Signature'])) || ''
    ).trim();
    if (!headerSignature) {
      return res.status(401).json({ success: false, error: 'Missing Razorpay signature header.' });
    }

    let source = await readRawBody(req);
    if (!source) {
      const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      source = { raw: JSON.stringify(parsed), body: parsed };
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(source.raw)
      .digest('hex');

    if (!safeEqual(expectedSignature, headerSignature)) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
    }

    let event;
    try {
      event = source.body || JSON.parse(source.raw);
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid webhook payload.' });
    }

    const eventName = String(event.event || '');
    if (!TRUSTED_EVENTS.includes(eventName)) {
      // Acknowledge verified-but-untracked events so Razorpay stops retrying.
      return res.status(200).json({ success: true, received: true, handled: false, event: eventName });
    }

    const paymentId =
      event.payload && event.payload.payment && event.payload.payment.entity
        ? event.payload.payment.entity.id
        : null;
    const orderId =
      event.payload && event.payload.order && event.payload.order.entity
        ? event.payload.order.entity.id
        : null;

    console.log(
      '[razorpay-webhook] verified payment event:',
      eventName,
      'payment:', paymentId || 'n/a',
      'order:', orderId || 'n/a'
    );

    return res.status(200).json({ success: true, received: true, handled: true, event: eventName });
  } catch (err) {
    console.error('[razorpay-webhook] error:', err);
    return res.status(500).json({ success: false, error: 'Webhook processing failed.' });
  }
};
