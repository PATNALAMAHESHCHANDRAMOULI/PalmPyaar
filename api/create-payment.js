const crypto = require('crypto');

/**
 * Vercel Serverless Function: POST /api/create-payment
 * Accepts { name, dob, birthplace, tradition, photoHash, tier }
 * Calls Instamojo Payment Requests API and returns { success: true, paymentUrl }
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { name, dob, birthplace, tradition, photoHash, tier } = body;

    if (!name || !dob || !birthplace) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, dob, and birthplace are required.'
      });
    }

    // Security Decision: Validate and sanitize string inputs with 100-character length limits
    // to prevent parameter bloating, log injection, or memory overhead.
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

    const selectedTier = (tier === 'couples' || tier === 'all') ? tier : 'standard';
    let amount = 49;
    if (selectedTier === 'couples') {
      amount = 79;
    } else if (selectedTier === 'all') {
      amount = 149;
    }

    const validTraditions = ['western', 'vedic', 'hellenic'];
    const selectedTradition = validTraditions.includes(tradition) ? tradition : 'western';
    const cleanPhotoHash = typeof photoHash === 'string' ? photoHash.slice(0, 64) : '';

    // Determine host for redirect URL
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';

    const redirectUrl = `${proto}://${hostHeader}/api/verify-payment?name=${encodeURIComponent(name)}&dob=${encodeURIComponent(dob)}&birthplace=${encodeURIComponent(birthplace)}&tradition=${encodeURIComponent(selectedTradition)}&photoHash=${encodeURIComponent(cleanPhotoHash)}&tier=${encodeURIComponent(selectedTier)}`;

    // Security Decision: Mandate server-side Instamojo credentials to prevent unauthenticated payment requests.
    const apiKey = process.env.INSTAMOJO_API_KEY;
    const authToken = process.env.INSTAMOJO_AUTH_TOKEN;
    const instamojoHost = process.env.INSTAMOJO_HOST || (process.env.INSTAMOJO_LIVE === 'true' ? 'www.instamojo.com' : 'test.instamojo.com');

    if (!apiKey || !authToken) {
      return res.status(500).json({
        success: false,
        error: 'Instamojo credentials missing on server. Set INSTAMOJO_API_KEY and INSTAMOJO_AUTH_TOKEN in Vercel environment variables.'
      });
    }

    const payload = new URLSearchParams();
    payload.append('purpose', `PalmPyaar Reading (${selectedTier})`);
    payload.append('amount', String(amount));
    payload.append('buyer_name', name);
    payload.append('redirect_url', redirectUrl);
    payload.append('send_email', 'false');
    payload.append('send_sms', 'false');
    payload.append('allow_repeated_payments', 'false');

    const instamojoEndpoint = `https://${instamojoHost}/api/1.1/payment-requests/`;

    // Security Decision: Use AbortController with a 10-second timeout to prevent serverless function hangs or resource exhaustion on external API calls.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(instamojoEndpoint, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'X-Auth-Token': authToken,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: payload.toString(),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json();

    if (response.ok && data.success && data.payment_request && data.payment_request.longurl) {
      return res.status(200).json({
        success: true,
        paymentUrl: data.payment_request.longurl
      });
    }

    const errorMsg = (data && (data.message || (data.reason && JSON.stringify(data.reason)))) || 'Failed to create payment request at Instamojo';
    return res.status(400).json({
      success: false,
      error: errorMsg
    });
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    return res.status(500).json({
      success: false,
      error: isAbort ? 'Payment gateway request timed out. Please try again.' : 'Server error processing payment: ' + (err.message || String(err))
    });
  }
};
