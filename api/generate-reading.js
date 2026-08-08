const crypto = require('crypto');
const templateProvider = require('../providers/templateProvider');
const groqProvider = require('../providers/groqProvider');

/**
 * Vercel Serverless Function: GET /api/generate-reading
 * Receives: { name, dob, birthplace, tradition, photoHash, orderId, token }
 * Security: Recomputes HMAC-SHA256 over received parameters using process.env.TOKEN_SECRET
 * Returns: { success: true, reading: { core, love, pro } }
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const params = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}))
      : (req.query || {});

    const name = String(params.name || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const dob = String(params.dob || '');
    const birthplace = String(params.birthplace || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const tradition = String(params.tradition || 'western');
    const photoHash = String(params.photoHash || '');
    const orderId = String(params.orderId || '');
    const token = String(params.token || '');

    // Security Decision: TOKEN_SECRET environment variable is mandatory.
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: TOKEN_SECRET is missing.'
      });
    }

    // DEVELOPMENT-ONLY TESTING BYPASS
    // This bypass exists ONLY for local development and MUST NOT be enabled in production.
    // It allows skipping HMAC token verification when both NODE_ENV=development AND DEV_BYPASS=true.
    // Production behavior remains unchanged - token verification is always enforced.
    const isDevBypass = process.env.NODE_ENV === 'development' && process.env.DEV_BYPASS === 'true';

    if (!isDevBypass) {
      if (!token) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Token parameter is required.'
        });
      }

      // Security Decision: Recompute HMAC-SHA256 signature server-side over identical payload string used during payment verification.
      const rawPayload = [name, dob, birthplace, tradition, photoHash, orderId].join(':');
      const expectedToken = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      // Security Decision: Use timingSafeEqual to prevent side-channel timing attacks during token comparison.
      const expectedBuf = Buffer.from(expectedToken, 'hex');
      const actualBuf = Buffer.from(token, 'hex');

      if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Token verification failed.'
        });
      }
    }
    // If dev bypass is active, token verification is skipped but provider selection and reading generation continue normally.

    // Select provider (default to templateProvider; AI reading toggled via AI_READING env flag)
    const useAi = process.env.AI_READING === 'true';
    console.log('[generate-reading] AI_READING env:', process.env.AI_READING);
    console.log('[generate-reading] useAi:', useAi);
    const provider = useAi ? groqProvider : templateProvider;
    console.log('[generate-reading] Selected provider:', provider.name);

    const reading = await provider.generateReading({
      name,
      dob,
      birthplace,
      tradition,
      photoHash
    });

    console.log('[generate-reading] Reading generated, sections:', {
      coreLength: reading.core.length,
      loveLength: reading.love.length,
      proLength: reading.pro.length,
      corePreview: reading.core.slice(0, 100),
      lovePreview: reading.love.slice(0, 100),
      proPreview: reading.pro.slice(0, 100)
    });

    return res.status(200).json({
      success: true,
      reading
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Server error generating reading: ' + (err.message || String(err))
    });
  }
};
