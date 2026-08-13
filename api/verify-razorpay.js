const crypto = require('crypto');
const stateToken = require('../lib/stateToken');
const { expectedAmountRupees, CURRENCY } = require('../lib/paymentConfig');
const { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');

/**
 * Vercel Serverless Function: POST /api/verify-razorpay
 *
 * The ONLY grant path for a paid PalmPyaar reading. Receives the Razorpay
 * Checkout response (razorpay_order_id, razorpay_payment_id,
 * razorpay_signature), the short-lived server-signed state token issued by
 * /api/create-payment, and the reading fields the browser submitted.
 *
 * The payment <-> reading binding is enforced ENTIRELY server-side:
 *
 *   1. Verify the state token (HMAC-SHA256, TOKEN_SECRET, short-lived).
 *      The state token was signed at order-creation time and binds the EXACT
 *      reading payload [name, dob, birthplace, tradition, photoHash, orderId]
 *      to the Razorpay order (razorpayOrderId, amount, amountPaise, currency).
 *   2. Order-ID consistency: the razorpayOrderId inside the verified state
 *      token MUST equal the razorpayOrderId being verified — a token cannot be
 *      substituted onto a different order.
 *   3. Amount/currency: the state token must record exactly the expected amount
 *      (₹49 = 4900 paise, INR). The order was created at that amount server-side
 *      and the Razorpay signature binds the payment to that order, so a payment
 *      for any other amount/order can never unlock a reading.
 *   4. Reading data is taken ONLY from the verified state token. Any reading
 *      fields supplied independently by the browser MUST match the token or the
 *      request is rejected — modified name/DOB/birthplace/tradition/photoHash/
 *      palmEvidence/orderId can never mint a token for different data.
 *   5. Verify the Razorpay payment signature server-side:
 *        HMAC-SHA256(key = RAZORPAY_KEY_SECRET,
 *                    message = razorpayOrderId + "|" + razorpayPaymentId)
 *      This cryptographically binds the payment to the exact Razorpay order.
 *   6. ONLY after all of the above, mint the existing-style HMAC reading token
 *      over [name, dob, birthplace, tradition, photoHash, palmEvidence, orderId]
 *      using TOKEN_SECRET and return the /result.html URL.
 *
 * SECURITY:
 *  - The frontend is never trusted: a payment is only considered paid when the
 *    Razorpay signature verifies AND the order matches the signed state token.
 *  - RAZORPAY_KEY_SECRET and TOKEN_SECRET are server-side only, never returned.
 *  - Replay/idempotency: token minting is deterministic per payload, so the
 *    same verified request always yields the same result URL (no duplicate
 *    grant). Replaying a captured request regenerates the SAME reading, never a
 *    different one.
 */

function safeEqualHex(a, b) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function buildResultUrl({ name, dob, birthplace, tradition, photoHash, palmEvidence, orderId, token }) {
  var params = [
    'name=' + encodeURIComponent(name),
    'dob=' + encodeURIComponent(dob),
    'birthplace=' + encodeURIComponent(birthplace),
    'tradition=' + encodeURIComponent(tradition),
    'photoHash=' + encodeURIComponent(photoHash),
    'orderId=' + encodeURIComponent(orderId),
    'token=' + token
  ];
  if (palmEvidence) {
    params.push('palmEvidence=' + encodeURIComponent(JSON.stringify(palmEvidence)));
  }
  return '/result.html?' + params.join('&');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const razorpayOrderId = String(body.razorpayOrderId || '').trim();
    const razorpayPaymentId = String(body.razorpayPaymentId || '').trim();
    const razorpaySignature = String(body.razorpaySignature || '').trim();
    const receivedStateToken = String(body.stateToken || '').trim();

    // Browser-supplied reading fields are ONLY cross-checked against the
    // verified state token. They are never used to build the reading.
    const browserName = String(body.name || '').trim().replace(/[\r\n\t]/g, ' ');
    const browserDob = String(body.dob || '').trim();
    const browserBirthplace = String(body.birthplace || '').trim().replace(/[\r\n\t]/g, ' ');
    const browserTradition = String(body.tradition || '').trim();
    const browserPhotoHash = String(body.photoHash || '').trim().toLowerCase();
     const browserOrderId = String(body.orderId || '').trim();

    // Browser-supplied palmEvidence is cross-checked against the verified state
    // token. If the browser sends evidence, it must match the token's value
    // exactly (deep equality via JSON stringification). If the browser omits it,
    // the token's value (possibly null) is authoritative.

    if (!receivedStateToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing payment session token. Please start a new checkout.'
      });
    }

    // --- Configuration: both secrets are mandatory (fail closed) ---
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keySecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: RAZORPAY_KEY_SECRET is missing. Set it in environment variables to verify payments.'
      });
    }

    const tokenSecret = (process.env.TOKEN_SECRET || '').trim();
    if (!tokenSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: TOKEN_SECRET is missing.'
      });
    }

    // --- 1. Verify the signed state token (signature + short-lived expiry) ---
    const state = stateToken.verify(receivedStateToken, tokenSecret);
    if (!state) {
      return res.status(403).json({
        success: false,
        error: 'Payment session is invalid or has expired. Please start a new checkout.'
      });
    }

    // --- 2. Order-ID consistency: the paid order must be the order the state
    //        token was created for. Prevents substituting a different order. ---
    if (state.razorpayOrderId !== razorpayOrderId) {
      return res.status(403).json({
        success: false,
        error: 'Payment order mismatch. Please start a new checkout.'
      });
    }

    // --- 3. Amount/currency enforcement (₹49 = 4900 paise, INR) ---
    const expectedAmount = expectedAmountRupees();
    if (expectedAmount === null) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: PAYMENT_AMOUNT must be a positive integer (rupees) no larger than 100000.'
      });
    }
    if (
      state.amount !== expectedAmount ||
      state.amountPaise !== expectedAmount * 100 ||
      state.currency !== CURRENCY
    ) {
      return res.status(403).json({
        success: false,
        error: 'Payment amount mismatch. Please start a new checkout.'
      });
    }

    // --- 4. Reading data must EXACTLY match the verified state token. Missing
    //        or modified name/DOB/birthplace/tradition/photoHash/palmEvidence/orderId
    //        are rejected — the browser can never mint a reading for other data. ---
    if (
      browserName !== state.name ||
      browserDob !== state.dob ||
      browserBirthplace !== state.birthplace ||
      browserTradition !== state.tradition ||
      browserPhotoHash !== state.photoHash ||
      browserOrderId !== state.orderId
    ) {
      return res.status(400).json({
        success: false,
        error: 'Reading data does not match the paid order. Please start a new checkout.'
      });
    }

    // --- 4b. palmEvidence cross-check: if the browser sent palmEvidence, it must
    //         match the value bound in the state token. The token's value is
    //         authoritative — the browser cannot upgrade a null token to evidence
    //         or substitute forged evidence. ---
    var statePalmEvidence = state.palmEvidence;
    var browserPalmEvidenceRaw = body.palmEvidence;
    var browserPalmEvidenceStr = (browserPalmEvidenceRaw === undefined || browserPalmEvidenceRaw === null)
      ? 'null'
      : JSON.stringify(browserPalmEvidenceRaw);
    var statePalmEvidenceStr = (statePalmEvidence === undefined || statePalmEvidence === null)
      ? 'null'
      : JSON.stringify(statePalmEvidence);
    if (browserPalmEvidenceStr !== statePalmEvidenceStr) {
      return res.status(400).json({
        success: false,
        error: 'Palm evidence does not match the paid order. Please start a new checkout.'
      });
    }

    // --- 5. Verify the Razorpay payment signature server-side. This binds the
    //        payment to the exact Razorpay order being verified. ---
    if (!/^[a-f0-9]{64}$/i.test(razorpaySignature)) {
      return res.status(400).json({ success: false, error: 'Invalid Razorpay signature.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    if (!safeEqualHex(expectedSignature, razorpaySignature)) {
      return res.status(403).json({
        success: false,
        error: 'Payment verification failed: invalid Razorpay signature.'
      });
    }

    // --- 6. Mint the existing-style HMAC reading token. Reading data is taken
    //        ONLY from the verified state token (never from the browser). ---
    const palmEvidenceStr = (statePalmEvidence === undefined || statePalmEvidence === null)
      ? ''
      : JSON.stringify(statePalmEvidence);
    const rawPayload = [state.name, state.dob, state.birthplace, state.tradition, state.photoHash, palmEvidenceStr, state.orderId].join(':');
    const token = crypto.createHmac('sha256', tokenSecret).update(rawPayload).digest('hex');

    const resultUrl = buildResultUrl({
      name: state.name,
      dob: state.dob,
      birthplace: state.birthplace,
      tradition: state.tradition,
      photoHash: state.photoHash,
      palmEvidence: statePalmEvidence,
      orderId: state.orderId,
      token
    });

    return res.status(200).json({
      success: true,
      verified: true,
      orderId: state.orderId,
      resultUrl
    });
  } catch (err) {
    console.error('[verify-razorpay] error:', err);
    return res.status(500).json({
      success: false,
      error: 'Could not verify payment. Please try again.'
    });
  }
};
