const crypto = require('crypto');

/**
 * Vercel Serverless Function: POST /api/create-payment
 *
 * Replaces the previous third-party payment gateway with a DIRECT UPI
 * payment flow (no PSP / bank API).
 *
 * Accepts { name, dob, birthplace, tradition, photoHash } and returns a
 * payment instruction payload:
 *   {
 *     success: true,
 *     payment: {
 *       upiId,          // PAYMENT_UPI_ID (the payee VPA)
 *       amount,         // PAYMENT_AMOUNT (integer rupees, default 49)
 *       payeeName,      // PAYMENT_PAYEE_NAME (default "PalmPyaar")
 *       note,           // PAYMENT_NOTE (default "PalmPyaar Reading")
 *       orderId,        // PP + 10 random hex chars (used as UPI tid)
 *       deepLink        // upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...&tid=<orderId>
 *     }
 *   }
 *
 * The upi:// deep link opens the customer's UPI app (Google Pay, PhonePe,
 * Paytm, etc.) for an inline payment to the configured VPA.
 *
 * SECURITY: This endpoint NEVER mints an access token and NEVER grants a
 * reading. Direct UPI gives no server-side settlement callback, so granting
 * without evidence is impossible by design. Only the owner can mint a token
 * via /api/admin-confirm-payment AFTER verifying the payment in their own
 * UPI app (see that handler for details).
 */
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({ success: false, error: 'Invalid date of birth format.' });
    }

    // Security Decision: Whitelist the reading tradition so the token payload
    // (and later HMAC) is built from a fixed, known value set.
    const TRADITIONS = ['western', 'vedic', 'hellenic'];
    const selectedTradition = String(tradition || 'western');
    if (!TRADITIONS.includes(selectedTradition)) {
      return res.status(400).json({ success: false, error: 'Invalid reading tradition.' });
    }

    // Security Decision: Photo hash must be the client-side SHA-256 hex digest
    // (64 chars) or empty. The image itself is never uploaded.
    const cleanPhotoHash = String(photoHash || '').trim().toLowerCase();
    if (cleanPhotoHash && !/^[a-f0-9]{64}$/.test(cleanPhotoHash)) {
      return res.status(400).json({ success: false, error: 'Invalid photo hash.' });
    }

    // --- UPI configuration ---
    const upiId = (process.env.PAYMENT_UPI_ID || '').trim().toLowerCase();
    if (!upiId) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: PAYMENT_UPI_ID is missing. Set the payee UPI ID (VPA) in environment variables.'
      });
    }

    const rawAmount = process.env.PAYMENT_AMOUNT || '49';
    const amount = parseInt(rawAmount, 10);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: PAYMENT_AMOUNT must be a positive integer (rupees) no larger than 100000.'
      });
    }

    // UPI pn field is limited (~25 chars); keep payee name short and safe.
    const payeeName = (process.env.PAYMENT_PAYEE_NAME || 'PalmPyaar').trim().replace(/[\r\n\t]/g, ' ').slice(0, 25);
    const note = (process.env.PAYMENT_NOTE || 'PalmPyaar Reading').trim().replace(/[\r\n\t]/g, ' ').slice(0, 30);

    // Security Decision: Order ID is generated server-side (never trusted from the
    // client). Format "PP" + 10 random uppercase hex chars = 12 chars, well within
    // the UPI tid limit, and unguessable so it can be bound into the access token.
    const orderId = 'PP' + crypto.randomBytes(5).toString('hex').toUpperCase();

    // Build the Google Pay / UPI-app-compatible deep link (standard upi:// scheme).
    const deepLinkParams = new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      am: String(amount),
      cu: 'INR',
      tn: note,
      tid: orderId
    });
    const deepLink = 'upi://pay?' + deepLinkParams.toString();

    return res.status(200).json({
      success: true,
      payment: {
        upiId,
        amount,
        payeeName,
        note,
        orderId,
        deepLink
      }
    });
  } catch (err) {
    console.error('[create-payment] error:', err);
    return res.status(500).json({
      success: false,
      error: 'Could not create payment instruction. Please try again.'
    });
  }
};
