const crypto = require('crypto');
const stateToken = require('../lib/stateToken');
const { expectedAmountRupees, CURRENCY } = require('../lib/paymentConfig');

/**
 * Vercel Serverless Function: POST /api/create-payment
 *
 * Creates a REAL Razorpay Order for the ₹49 PalmPyaar reading. This replaces
 * the previous direct-UPI deep-link flow (no PSP callback).
 *
 * Accepts { name, dob, birthplace, tradition, photoHash }.
 * photoHash is REQUIRED: a client-side SHA-256 hex digest of the hand photo.
 * The raw image is never uploaded; only the digest is transmitted.
 *
 * Returns:
 *   {
 *     success: true,
 *     payment: {
 *       orderId,          // internal "PP" + 10 hex chars (Razorpay receipt + token binding)
 *       razorpayOrderId,  // id returned by Razorpay POST /v1/orders
 *       keyId,            // RAZORPAY_KEY_ID (public; required by Razorpay Checkout)
 *       amount,           // rupees (PAYMENT_AMOUNT, default 49)
 *       amountPaise,      // amount * 100 (Razorpay expects the smallest currency unit)
 *       currency,         // "INR"
 *       stateToken,       // short-lived server-signed binding of the EXACT reading
 *                         // payload to razorpayOrderId (required at verification)
 *       stateTokenTtlSeconds
 *     }
 *   }
 *
 * SECURITY (payment <-> reading binding):
 *  - This endpoint cryptographically binds the EXACT reading payload
 *    [name, dob, birthplace, tradition, photoHash, orderId] to the generated
 *    Razorpay order via a short-lived HMAC state token signed with TOKEN_SECRET.
 *  - /api/verify-razorpay later reads the reading data ONLY from that verified
 *    token, so a paid order can never be replayed against modified reading data.
 *  - RAZORPAY_KEY_SECRET lives server-side only and is NEVER returned to the
 *    client. RAZORPAY_KEY_ID is public and safe to expose for the checkout.
 *  - This endpoint NEVER mints an access/reading token. The ONLY grant path is
 *    /api/verify-razorpay, which verifies the Razorpay payment signature
 *    server-side before minting the reading token.
 */

async function createRazorpayOrder({ amountPaise, receipt }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes: { product: 'PalmPyaar Personalized Reading' }
      }),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = data && data.error && data.error.description
        ? data.error.description
        : 'HTTP ' + res.status;
      const err = new Error('Razorpay order creation failed: ' + detail);
      err.statusCode = 502;
      throw err;
    }

    if (!data || !/^order_[A-Za-z0-9]+$/.test(String(data.id || ''))) {
      const err = new Error('Razorpay returned an invalid order id.');
      err.statusCode = 502;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { name, dob, birthplace, tradition, photoHash } = body;

    if (!name || !dob || !birthplace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, dob, and birthplace are required.'
      });
    }

    // Security Decision: Validate and sanitize string inputs with 100-character
    // length limits to prevent parameter bloating, log injection, or memory overhead.
    name = String(name).trim().replace(/[\r\n\t]/g, ' ');
    birthplace = String(birthplace).trim().replace(/[\r\n\t]/g, ' ');

    if (name.length > 100) {
      return res.status(400).json({ success: false, error: 'Name must be 100 characters or fewer.' });
    }
    if (birthplace.length > 100) {
      return res.status(400).json({ success: false, error: 'Birthplace must be 100 characters or fewer.' });
    }

    // Validate DOB format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dob))) {
      return res.status(400).json({ success: false, error: 'Invalid date of birth format.' });
    }

    // Security Decision: Whitelist the reading tradition so the token payload
    // (and later HMAC) is built from a fixed, known value set.
    const TRADITIONS = ['western', 'vedic', 'hellenic'];
    const selectedTradition = String(tradition || 'western');
    if (!TRADITIONS.includes(selectedTradition)) {
      return res.status(400).json({ success: false, error: 'Invalid reading tradition.' });
    }

    // Security Decision: The hand photo is REQUIRED for the paid reading. The
    // photoHash must be the client-side SHA-256 hex digest (64 chars). The raw
    // image itself is never uploaded. Backend enforces presence so that
    // frontend-only checks cannot be bypassed.
    const cleanPhotoHash = String(photoHash || '').trim().toLowerCase();
    if (!cleanPhotoHash) {
      return res.status(400).json({
        success: false,
        error: 'A hand photo is required. Provide the SHA-256 hash of your palm photo.'
      });
    }
    if (!/^[a-f0-9]{64}$/.test(cleanPhotoHash)) {
      return res.status(400).json({ success: false, error: 'Invalid photo hash.' });
    }

    // --- Razorpay configuration (key id public; key secret server-only) ---
    const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keyId || !keySecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment variables.'
      });
    }

    // Security Decision: TOKEN_SECRET is required to sign the state token that
    // binds the reading payload to the Razorpay order. Fails closed BEFORE any
    // order is created so an unbound order can never be generated.
    const tokenSecret = (process.env.TOKEN_SECRET || '').trim();
    if (!tokenSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: TOKEN_SECRET is missing. It is required to bind the payment to the reading data.'
      });
    }

    const amount = expectedAmountRupees();
    if (amount === null) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: PAYMENT_AMOUNT must be a positive integer (rupees) no larger than 100000.'
      });
    }
    const amountPaise = amount * 100;

    // Security Decision: Internal order id is generated server-side (never
    // trusted from the client). Format "PP" + 10 random uppercase hex chars =
    // 12 chars, unguessable, and used as the Razorpay receipt + token binding.
    const orderId = 'PP' + crypto.randomBytes(5).toString('hex').toUpperCase();

    let razorpayOrder;
    try {
      razorpayOrder = await createRazorpayOrder({ amountPaise, receipt: orderId });
    } catch (err) {
      console.error('[create-payment] Razorpay order failed:', err.message);
      const status = err.statusCode || 502;
      return res.status(status).json({
        success: false,
        error: 'Could not create the payment order. Please try again later.'
      });
    }

    // Security Decision: Cryptographically bind the EXACT reading payload to
    // this Razorpay order. The state token is signed server-side (TOKEN_SECRET),
    // short-lived, and is what /api/verify-razorpay will trust to rebuild the
    // reading parameters. The browser cannot alter any bound field without
    // invalidating the signature.
    const now = Math.floor(Date.now() / 1000);
    const state = stateToken.sign({
      v: 1,
      razorpayOrderId: razorpayOrder.id,
      name,
      dob: String(dob),
      birthplace,
      tradition: selectedTradition,
      photoHash: cleanPhotoHash,
      orderId,
      amount,
      amountPaise,
      currency: CURRENCY,
      iat: now,
      exp: now + stateToken.TTL_SECONDS
    }, tokenSecret);

    return res.status(200).json({
      success: true,
      payment: {
        orderId,
        razorpayOrderId: razorpayOrder.id,
        keyId,
        amount,
        amountPaise,
        currency: CURRENCY,
        stateToken: state,
        stateTokenTtlSeconds: stateToken.TTL_SECONDS
      }
    });
  } catch (err) {
    console.error('[create-payment] error:', err);
    return res.status(500).json({
      success: false,
      error: 'Could not create payment order. Please try again.'
    });
  }
};

module.exports.createRazorpayOrder = createRazorpayOrder;
