const crypto = require('crypto');

/**
 * Vercel Serverless Function: GET /api/verify-payment
 * Called via redirect from Instamojo with query params:
 * payment_id, payment_request_id, payment_status, name, dob, birthplace, tradition, photoHash, tier
 * Calls Instamojo Payment Detail API server-side to confirm payment status === "Credit"
 * On success, generates HMAC-SHA256 token and redirects to /result.html
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const query = req.query || {};
    const paymentId = query.payment_id;
    const paymentRequestId = query.payment_request_id;
    let name = query.name || '';
    const dob = query.dob || '';
    let birthplace = query.birthplace || '';
    const tradition = query.tradition || 'western';
    const photoHash = query.photoHash || '';
    const tier = query.tier || 'standard';

    // Security Decision: Require mandatory payment parameters passed back from gateway.
    if (!paymentId || !paymentRequestId) {
      const redirectFailed = `/index.html?payment=missing_params`;
      res.writeHead(302, { Location: redirectFailed });
      return res.end();
    }

    // Security Decision: Validate and sanitize input strings with a 100-character max limit
    // to prevent parameter manipulation, log injection, or token bloating.
    name = String(name).trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    birthplace = String(birthplace).trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);

    // Security Decision: Remove default TOKEN_SECRET fallback. Require TOKEN_SECRET environment variable;
    // fail securely with a server configuration error if unconfigured to prevent forged signatures.
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
      const errorUrl = `/index.html?payment=config_error`;
      res.writeHead(302, { Location: errorUrl });
      return res.end();
    }

    // Security Decision: Mandate server API credentials for authenticating requests to Instamojo.
    const apiKey = process.env.INSTAMOJO_API_KEY;
    const authToken = process.env.INSTAMOJO_AUTH_TOKEN;
    const instamojoHost = process.env.INSTAMOJO_HOST || (process.env.INSTAMOJO_LIVE === 'true' ? 'www.instamojo.com' : 'test.instamojo.com');

    if (!apiKey || !authToken) {
      const failedUrl = `/index.html?payment=config_error`;
      res.writeHead(302, { Location: failedUrl });
      return res.end();
    }

    let paymentVerified = false;
    let verifiedOrderId = paymentId;

    // Security Decision: Use AbortController with a 10-second timeout to prevent serverless function hangs on slow gateway calls.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const verifyEndpoint = `https://${instamojoHost}/api/1.1/payment-requests/${paymentRequestId}/${paymentId}/`;
      const verifyResponse = await fetch(verifyEndpoint, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
          'X-Auth-Token': authToken
        },
        signal: controller.signal
      });

      if (verifyResponse.ok) {
        const data = await verifyResponse.json();
        // Security Decision: Verify strictly against documented successful payment status ("Credit").
        // Reject all unverified, pending, or fallback states to prevent paywall bypass.
        if (data && data.success && data.payment_request && data.payment_request.payment) {
          if (data.payment_request.payment.status === 'Credit') {
            paymentVerified = true;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!paymentVerified) {
      const failedUrl = `/index.html?payment=failed`;
      res.writeHead(302, { Location: failedUrl });
      return res.end();
    }

    // Security Decision: Compute HMAC-SHA256 signature using secret over verified order ID and user parameters.
    const rawPayload = [name, dob, birthplace, tradition, photoHash, tier, verifiedOrderId].join(':');
    const token = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

    const resultUrl = `/result.html?name=${encodeURIComponent(name)}&dob=${encodeURIComponent(dob)}&birthplace=${encodeURIComponent(birthplace)}&tradition=${encodeURIComponent(tradition)}&photoHash=${encodeURIComponent(photoHash)}&tier=${encodeURIComponent(tier)}&orderId=${encodeURIComponent(verifiedOrderId)}&token=${token}`;

    res.writeHead(302, { Location: resultUrl });
    return res.end();
  } catch (err) {
    const errorUrl = `/index.html?payment=error`;
    res.writeHead(302, { Location: errorUrl });
    return res.end();
  }
};
