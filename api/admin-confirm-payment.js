const crypto = require('crypto');

/**
 * Vercel Serverless Function: POST /api/admin-confirm-payment
 *
 * Owner-only endpoint (the SOLE grant path in the direct UPI flow).
 *
 * Because direct UPI provides no server-side settlement callback, the owner
 * manually confirms the credit in their own UPI app (using the customer's
 * UTR) and then calls this endpoint to mint the HMAC access token that
 * unlocks /result.html via /api/generate-reading.
 *
 * Auth: requires header "x-admin-secret" (or body "adminSecret") to match
 * process.env.ADMIN_CONFIRM_SECRET via constant-time comparison.
 *
 * Accepts { name, dob, birthplace, tradition, photoHash, orderId }.
 * Returns { success: true, resultUrl: "/result.html?name=...&token=..." }.
 *
 * The token payload MUST match exactly what /api/generate-reading recomputes:
 *   [name, dob, birthplace, tradition, photoHash, orderId].join(':')
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // --- Owner authentication ---
    const configuredSecret = process.env.ADMIN_CONFIRM_SECRET;
    if (!configuredSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: ADMIN_CONFIRM_SECRET is missing. Set it in environment variables to enable payment confirmation.'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const headerSecret = req.headers && req.headers['x-admin-secret'];
    const providedSecret = String(headerSecret || body.adminSecret || '');

    // Security Decision: constant-time comparison to avoid leaking the secret.
    const providedBuf = Buffer.from(providedSecret, 'utf8');
    const configuredBuf = Buffer.from(configuredSecret, 'utf8');
    if (providedBuf.length !== configuredBuf.length || !crypto.timingSafeEqual(providedBuf, configuredBuf)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: invalid confirmation secret.' });
    }

    // --- Reading parameters ---
    let { name, dob, birthplace, tradition, photoHash, orderId } = body;

    if (!name || !dob || !birthplace || !orderId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, dob, birthplace, and orderId are required.'
      });
    }

    name = String(name).trim().replace(/[\r\n\t]/g, ' ');
    birthplace = String(birthplace).trim().replace(/[\r\n\t]/g, ' ');
    orderId = String(orderId).trim();

    if (name.length > 100) {
      return res.status(400).json({ success: false, error: 'Name must be 100 characters or fewer.' });
    }
    if (birthplace.length > 100) {
      return res.status(400).json({ success: false, error: 'Birthplace must be 100 characters or fewer.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dob))) {
      return res.status(400).json({ success: false, error: 'Invalid date of birth format.' });
    }

    const TRADITIONS = ['western', 'vedic', 'hellenic'];
    const selectedTradition = String(tradition || 'western');
    if (!TRADITIONS.includes(selectedTradition)) {
      return res.status(400).json({ success: false, error: 'Invalid reading tradition.' });
    }

    if (!/^[A-Za-z0-9_-]{4,32}$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id format.' });
    }

    const cleanPhotoHash = String(photoHash || '').trim().toLowerCase();
    if (cleanPhotoHash && !/^[a-f0-9]{64}$/.test(cleanPhotoHash)) {
      return res.status(400).json({ success: false, error: 'Invalid photo hash.' });
    }

    // --- Token minting (same payload contract as generate-reading) ---
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: TOKEN_SECRET is missing.'
      });
    }

    const rawPayload = [name, dob, birthplace, selectedTradition, cleanPhotoHash, orderId].join(':');
    const token = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

    const resultUrl =
      '/result.html?' +
      'name=' + encodeURIComponent(name) +
      '&dob=' + encodeURIComponent(dob) +
      '&birthplace=' + encodeURIComponent(birthplace) +
      '&tradition=' + encodeURIComponent(selectedTradition) +
      '&photoHash=' + encodeURIComponent(cleanPhotoHash) +
      '&orderId=' + encodeURIComponent(orderId) +
      '&token=' + token;

    return res.status(200).json({
      success: true,
      confirmed: true,
      orderId,
      resultUrl
    });
  } catch (err) {
    console.error('[admin-confirm-payment] error:', err);
    return res.status(500).json({
      success: false,
      error: 'Could not confirm payment. Please try again.'
    });
  }
};
