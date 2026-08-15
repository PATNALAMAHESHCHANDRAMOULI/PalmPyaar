/**
 * PalmPyaar Ask-Question API — POST /api/ask-question
 *
 * Post-payment 3-question entitlement endpoint. After a successful payment,
 * the customer can ask up to 3 follow-up questions about their reading.
 *
 * Each question is answered using the template provider (deterministic) or
 * the AI provider (Groq, when AI_READING=true), with the same safety guardrails
 * as the main reading.
 *
 * Security:
 * - Requires a valid question token (HMAC-signed, TOKEN_SECRET).
 * - The question token embeds the reading token (from verify-razorpay) and
 *   a question count (0-3). The count is server-signed; the frontend cannot
 *   fabricate additional questions.
 * - The reading token is re-verified against the same HMAC as generate-reading.js.
 * - When questionCount reaches MAX_QUESTIONS (3), no further questions are allowed.
 *
 * The endpoint is stateless: the question count and history are embedded in
 * the signed token. Each response returns a new token with the incremented count.
 */

'use strict';

const crypto = require('crypto');
const questionToken = require('../lib/questionToken');
const templateProvider = require('../providers/templateProvider');
const groqProvider = require('../providers/groqProvider');
const { calculateChart } = require('../lib/astrologyProvider');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body || {});

    const questionTokenStr = String(body.questionToken || '').trim();
    const question = String(body.question || '').trim();
    const readingToken = String(body.readingToken || '').trim();
    const name = String(body.name || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const dob = String(body.dob || '').trim();
    const birthTime = String(body.birthTime || '').trim();
    const birthplace = String(body.birthplace || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const tradition = String(body.tradition || 'western').trim();
    const photoHash = String(body.photoHash || '').trim().toLowerCase();
    const palmEvidence = body.palmEvidence || null;
    const nakshatraMode = String(body.nakshatraMode || '').trim();
    const nakshatra = String(body.nakshatra || '').trim();
    const orderId = String(body.orderId || '').trim();

    // --- Validate question input ---
    if (!question || question.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'A question is required (max 500 characters).'
      });
    }

    // --- Validate TOKEN_SECRET ---
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: TOKEN_SECRET is missing.'
      });
    }

    // --- DEVELOPMENT-ONLY TESTING BYPASS ---
    // Same rule as generate-reading.js: only skips token verification when
    // both NODE_ENV=development AND DEV_BYPASS=true. Production always
    // enforces token verification.
    const isDevBypass = process.env.NODE_ENV === 'development' && process.env.DEV_BYPASS === 'true';

    let verifiedPayload = null;

    if (!isDevBypass) {
      // --- Verify the question token ---
      verifiedPayload = questionToken.verify(questionTokenStr, secret);
      if (!verifiedPayload) {
        return res.status(403).json({
          success: false,
          error: 'Invalid or expired question token.'
        });
      }

      // --- Re-verify the embedded reading token against the same HMAC ---
      // The reading token is HMAC-SHA256 over:
      // [name:dob:birthTime:birthplace:tradition:photoHash:palmEvidenceStr:orderId]
      var palmEvidenceStr = '';
      if (palmEvidence) {
        try {
          const parsed = JSON.parse(typeof palmEvidence === 'string' ? palmEvidence : JSON.stringify(palmEvidence));
          palmEvidenceStr = JSON.stringify(parsed);
        } catch (e) {
          palmEvidenceStr = '';
        }
      }

      var rawPayload = [name, dob, birthTime, birthplace, tradition, photoHash, palmEvidenceStr, orderId].join(':');
      const expectedReadingToken = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const expectedBuf = Buffer.from(expectedReadingToken, 'hex');
      const actualBuf = Buffer.from(verifiedPayload.readingToken, 'hex');

      if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
        return res.status(403).json({
          success: false,
          error: 'Reading token verification failed.'
        });
      }

      // --- Re-verify the standalone reading token too ---
      const standaloneExpectedBuf = Buffer.from(expectedReadingToken, 'hex');
      const standaloneActualBuf = Buffer.from(readingToken || '', 'hex');
      if (standaloneActualBuf.length === 0 ||
          standaloneExpectedBuf.length !== standaloneActualBuf.length ||
          !crypto.timingSafeEqual(standaloneExpectedBuf, standaloneActualBuf)) {
        return res.status(403).json({
          success: false,
          error: 'Reading token mismatch.'
        });
      }

      // --- Check question count ---
      if (verifiedPayload.questionCount >= questionToken.MAX_QUESTIONS) {
        return res.status(403).json({
          success: false,
          error: 'You have used all your questions. Thank you for your engagement.',
          questionsUsed: verifiedPayload.questionCount,
          maxQuestions: questionToken.MAX_QUESTIONS,
          questions: verifiedPayload.questions || []
        });
      }
    } else {
      // In dev bypass mode, create a synthetic payload.
      // If a questionTokenStr is provided, verify it to extract the
      // current question count so that the counter propagates across
      // requests during local testing.
      verifiedPayload = {
        readingToken: readingToken || '',
        questionCount: 0,
        maxQuestions: questionToken.MAX_QUESTIONS,
        questions: [],
        readingData: null
      };
      if (questionTokenStr) {
        const verified = questionToken.verify(questionTokenStr, secret);
        if (verified) {
          verifiedPayload.questionCount = verified.questionCount;
          verifiedPayload.questions = verified.questions || [];
        }
      }
    }

    // --- Compute astrology data (same as generate-reading) ---
    var astrologyData = null;
    try {
      astrologyData = calculateChart(dob, birthTime, birthplace, tradition);
    } catch (err) {
      console.warn('[ask-question] Astrology calculation failed:', err.message);
    }

    // --- Select provider ---
    const useAi = process.env.AI_READING === 'true';
    const provider = useAi ? groqProvider : templateProvider;

    // --- Generate answer ---
    // The answer is derived from the same template/AI logic as the reading,
    // but focused on the specific question asked.
    let answer;
    if (useAi && process.env.AROQ_API_KEY) {
      answer = await generateAiAnswer(provider, { name, dob, birthTime, birthplace, tradition, photoHash, palmEvidence, astrologyData, question, nakshatraMode, nakshatra });
    } else {
      answer = generateTemplateAnswer({ name, dob, birthTime, birthplace, tradition, astrologyData, question, nakshatraMode, nakshatra });
    }

     // --- Issue next token ---
    let newToken = null;
    if (isDevBypass) {
      // During local testing, derive readingToken from verified count or
      // fall back to the raw readingToken from the request body.
      const payloadReadingToken = verifiedPayload.readingToken || readingToken || '';
      newToken = questionToken.issueNextToken(
        {
          ...verifiedPayload,
          readingToken: payloadReadingToken,
          readingData: {
            name: name || 'Dev',
            dob: dob || '2000-01-01',
            birthTime: birthTime || '',
            birthplace: birthplace || '',
            tradition: tradition || 'western',
            orderId: orderId || 'dev-order'
          }
        },
        secret,
        question,
        answer
      );
    } else {
      newToken = questionToken.issueNextToken(verifiedPayload, secret, question, answer);
    }

    const remaining = questionToken.getRemainingCount(verifiedPayload) - 1;
    const questionsUsed = verifiedPayload.questionCount + 1;

    return res.status(200).json({
      success: true,
      answer: answer,
      questionsUsed: questionsUsed,
      remainingQuestions: Math.max(0, remaining),
      maxQuestions: questionToken.MAX_QUESTIONS,
      questionToken: newToken, // Client should store this for the next question
      provider: useAi ? 'groq' : 'template'
    });
  } catch (err) {
    console.error('[ask-question] Error:', err);
    return res.status(500).json({
      success: false,
      error: 'Server error processing question.'
    });
  }
};

/**
 * Generate a deterministic answer using the template provider.
 */
function generateTemplateAnswer(params) {
  const question = params.question || '';
  const name = params.name || 'Seeker';
  const sign = getZodiacSign(params.dob);
  const astro = params.astrologyData;
  const nakshatraMode = params.nakshatraMode;
  const nakshatra = params.nakshatra;

  // Build a contextual answer that references the user's birth details
  // and astrological configuration, but never makes guarantees.
  var parts = [];

  var greeting = '<p class="reading-paragraph">Regarding your question: <em>"' + escapeHtml(question) + '"</em></p>';
  parts.push(greeting);

  var insight;
  if (astro && astro.vedic) {
    const dashaLord = astro.vedic.dasha && astro.vedic.dasha.mahaDasha
      ? astro.vedic.dasha.mahaDasha.lord : 'the current period';
    var nakshatraName = astro.vedic.nakshatra ? astro.vedic.nakshatra.name : 'the Moon in a significant Nakshatra';
    if (nakshatraMode === 'known' && nakshatra) {
      nakshatraName = nakshatra + ' (your selected Nakshatra)';
    }
    insight = '<p class="reading-paragraph">As a ' + (astro.vedic.rashi ? astro.vedic.rashi.sign : sign) +
      ' with ' + nakshatraName +
      ', your ' + dashaLord + ' period offers a natural window for reflection on this matter. Consider how the themes of growth and self-understanding can inform your approach.</p>';
  } else if (astro && astro.hellenistic) {
    const lot = astro.hellenistic.lots && astro.hellenistic.lots.fortune
      ? astro.hellenistic.lots.fortune.sign : sign;
    insight = '<p class="reading-paragraph">From your Hellenic configuration with ' + (astro.hellenistic.sect || 'day') +
      ' sect and Fortune in ' + lot + ', the planetary condition suggests approaching this question with measured consideration. The lot of Fortune points toward avenues of self-contemplation.</p>';
  } else {
    insight = '<p class="reading-paragraph">As a ' + sign + ', your natural temperament offers a reflective lens on this inquiry. Consider how the themes of growth, balance, and self-understanding can inform your approach.</p>';
  }
  parts.push(insight);

  var reflection = '<blockquote class="reading-quote">The path forward often reveals itself when we pause to observe the question rather than rush toward the answer.</blockquote>';
  parts.push(reflection);

  var closing;
  if (astro && astro.meta && astro.meta.tradition) {
    closing = '<p class="reading-paragraph">This reflection draws on your ' + escapeHtml(astro.meta.tradition) +
      ' celestial configuration. It is offered as thoughtful perspective, not definitive guidance.</p>';
  } else {
    closing = '<p class="reading-paragraph">This reflection is offered as thoughtful perspective, not definitive guidance.</p>';
  }
  parts.push(closing);

  return parts.join('\n');
}

/**
 * Generate an AI-powered answer using the Groq provider.
 */
async function generateAiAnswer(provider, params) {
  const question = params.question || '';

  // Use the template provider as a structural fallback if AI fails
  const templateAnswer = generateTemplateAnswer(params);

  if (!provider || typeof provider.generateAnswer !== 'function') {
    return templateAnswer;
  }

  try {
    const result = await provider.generateAnswer(params);
    if (result && result.answer && result.answer.trim().length > 0) {
      return result.answer;
    }
  } catch (err) {
    console.warn('[ask-question] AI answer generation failed:', err.message);
  }

  return templateAnswer;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getZodiacSign(dob) {
  if (!dob) return 'Zodiac Sign';
  var parts = dob.split('-');
  if (parts.length !== 3) return 'Zodiac Sign';
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d)) return 'Zodiac Sign';

  var SIGNS = [
    { name: 'Capricorn', start: [12, 22], end: [1, 19] },
    { name: 'Aquarius', start: [1, 20], end: [2, 18] },
    { name: 'Pisces', start: [2, 19], end: [3, 20] },
    { name: 'Aries', start: [3, 21], end: [4, 19] },
    { name: 'Taurus', start: [4, 20], end: [5, 20] },
    { name: 'Gemini', start: [5, 21], end: [6, 20] },
    { name: 'Cancer', start: [6, 21], end: [7, 22] },
    { name: 'Leo', start: [7, 23], end: [8, 22] },
    { name: 'Virgo', start: [8, 23], end: [9, 22] },
    { name: 'Libra', start: [9, 23], end: [10, 22] },
    { name: 'Scorpio', start: [10, 23], end: [11, 21] },
    { name: 'Sagittarius', start: [11, 22], end: [12, 21] }
  ];

  for (var i = 0; i < SIGNS.length; i++) {
    var sign = SIGNS[i];
    var sm = sign.start[0], sd = sign.start[1];
    var em = sign.end[0], ed = sign.end[1];
    if (sm === em && m === sm && d >= sd && d <= ed) return sign.name;
    if (sm > em && ((m === sm && d >= sd) || (m === em && d <= ed))) return sign.name;
    if (sm < em && ((m === sm && d >= sd) || (m === em && d <= ed) || (m > sm && m < em))) return sign.name;
  }
  return 'Zodiac Sign';
}

module.exports.createInitialQuestionToken = function(readingToken, secret, readingData) {
  return questionToken.createInitialToken(readingToken, secret, readingData);
};
