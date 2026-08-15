const crypto = require('crypto');
const templateProvider = require('../providers/templateProvider');
const groqProvider = require('../providers/groqProvider');
const { isValidPalmEvidence } = require('../lib/palmEvidenceValidator');
const { calculateChart } = require('../lib/astrologyProvider');

/**
 * Vercel Serverless Function: GET /api/generate-reading
 * Receives: { name, dob, birthplace, tradition, photoHash, palmEvidence, orderId, token }
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
    const birthTime = String(params.birthTime || '').trim();
    const birthplace = String(params.birthplace || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const tradition = String(params.tradition || 'western');
    const photoHash = String(params.photoHash || '');
    const orderId = String(params.orderId || '');
    const token = String(params.token || '');
    const nakshatraMode = String(params.nakshatraMode || '').trim();
    const nakshatra = String(params.nakshatra || '').trim();

    // Security Decision: palmEvidence is optional. When present (from the signed
    // result URL), validate it with the strict server-side whitelist before
    // forwarding to the provider. If it fails validation, reject — never trust
    // malformed evidence.
    var palmEvidence = null;
    if (params.palmEvidence) {
      try {
        palmEvidence = JSON.parse(typeof params.palmEvidence === 'string' ? params.palmEvidence : JSON.stringify(params.palmEvidence));
      } catch (e) {
        palmEvidence = null;
      }
      if (!isValidPalmEvidence(palmEvidence)) {
        console.warn('[generate-reading] Invalid palmEvidence received; proceeding without it');
        palmEvidence = null;
      }
    }

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

       // Security Decision: Recompute HMAC-SHA256 signature server-side over
       // identical payload string used during payment verification. palmEvidence
       // (if present) is stringified and included between photoHash and orderId
       // to match the verify-razorpay token minting exactly.
       var palmEvidenceStr = palmEvidence ? JSON.stringify(palmEvidence) : '';
        var rawPayload = [name, dob, birthTime, birthplace, tradition, photoHash, palmEvidenceStr, orderId].join(':');
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

    // Compute astrology chart from verified birth parameters.
    // Only computed when birthTime is provided; falls back gracefully.
    var astrologyData = null;
    try {
      astrologyData = calculateChart(dob, birthTime, birthplace, tradition);
    } catch (err) {
      console.warn('[generate-reading] Astrology calculation failed:', err.message);
    }

    const reading = await provider.generateReading({
      name,
      dob,
      birthTime,
      birthplace,
      tradition,
      photoHash,
      palmEvidence,
      astrologyData,
      nakshatraMode,
      nakshatra
    });

    console.log('[generate-reading] Reading generated, sections:', {
      coreLength: reading.core.length,
      loveLength: reading.love.length,
      proLength: reading.pro.length,
      corePreview: reading.core.slice(0, 100),
      lovePreview: reading.love.slice(0, 100),
      proPreview: reading.pro.slice(0, 100)
    });

    // Truthful source labeling: template mode is intentional and labeled AI=false;
    // AI mode carries aiGenerated/metadata from the provider so a template
    // fallback can never be mistaken for genuine AI output.
    const aiGenerated = reading.aiGenerated === true;
    const providerName = useAi ? 'groq' : 'template';

    return res.status(200).json({
      success: true,
      reading,
      provider: providerName,
      aiGenerated,
      astrologyData: astrologyData || null
    });
  } catch (err) {
    // Log the real error server-side, but never leak internal details to the client.
    console.error('[generate-reading] Unexpected error:', err && err.message ? err.message : err);
    return res.status(500).json({
      success: false,
      error: 'Server error generating reading. Please try again.'
    });
  }
};
