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
const questionReplayStore = require('../lib/questionReplayStore');
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
    const questionIntent = classifyQuestionIntent(question);
    if (useAi && process.env.GROQ_API_KEY) {
      answer = await generateAiAnswer(provider, { name, dob, birthTime, birthplace, tradition, photoHash, palmEvidence, astrologyData, question, questionIntent, nakshatraMode, nakshatra });
    } else {
      answer = generateTemplateAnswer({ name, dob, birthTime, birthplace, tradition, astrologyData, question, questionIntent, nakshatraMode, nakshatra });
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

    const replayResult = await questionReplayStore.consumeQuestionToken({
      readingToken: verifiedPayload.readingToken,
      currentToken: questionTokenStr,
      nextToken: newToken,
      questionCount: verifiedPayload.questionCount
    });
    if (!replayResult.ok) {
      return res.status(replayResult.status || 409).json({
        success: false,
        error: replayResult.error || 'This question token is no longer valid.'
      });
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
 * Identify the user's follow-up intent. This is used internally only to keep
 * deterministic fallback answers focused on the actual question.
 */
function classifyQuestionIntent(question) {
  const q = String(question || '').toLowerCase();
  const intent = {
    topic: 'general',
    timing: /\b(when|date|year|age|month|how soon|time|timing|window)\b/.test(q)
  };

  if (/\b(job|career|work|promotion|interview|profession|business|employment)\b/.test(q)) intent.topic = 'career/job';
  else if (/\b(money|wealth|income|salary|finance|financial|rich|debt)\b/.test(q)) intent.topic = 'money';
  else if (/\b(marriage|married|spouse|husband|wife|wedding)\b/.test(q)) intent.topic = 'marriage';
  else if (/\b(relationship|love|partner|girlfriend|boyfriend|dating|romance|meet someone|crush)\b/.test(q)) intent.topic = 'relationship/love';
  else if (/\b(virginity|sex|intimacy|intimate|physical closeness)\b/.test(q)) intent.topic = 'intimacy';
  else if (/\b(education|study|studies|exam|college|university|degree|school)\b/.test(q)) intent.topic = 'education';
  else if (/\b(travel|abroad|foreign|relocation|relocate|move|migration|overseas)\b/.test(q)) intent.topic = 'travel/relocation';
  else if (/\b(family|parents|mother|father|sibling|children|child)\b/.test(q)) intent.topic = 'family';
  else if (/\b(compatible|compatibility|match|synastry)\b/.test(q)) intent.topic = 'compatibility';

  return intent;
}

function getTopicNoun(topic) {
  switch (topic) {
    case 'career/job': return 'career and job prospects';
    case 'money': return 'money and financial stability';
    case 'marriage': return 'marriage timing and partnership';
    case 'relationship/love': return 'love and relationship dynamics';
    case 'intimacy': return 'romantic intimacy and readiness';
    case 'education': return 'education and study direction';
    case 'travel/relocation': return 'travel or relocation prospects';
    case 'family': return 'family matters';
    case 'compatibility': return 'compatibility';
    default: return 'your question';
  }
}

function getTraditionFactors(astro, tradition, fallbackSign, nakshatraMode, nakshatra) {
  if (!astro || typeof astro !== 'object') {
    return {
      label: 'birth-sign context',
      text: 'your ' + fallbackSign + ' birth-sign context',
      hasTiming: false,
      timingText: ''
    };
  }

  if (tradition === 'vedic' && astro.vedic) {
    const rashi = astro.vedic.rashi && astro.vedic.rashi.sign ? astro.vedic.rashi.sign : fallbackSign;
    var nakshatraName = astro.vedic.nakshatra && astro.vedic.nakshatra.name ? astro.vedic.nakshatra.name : '';
    if (nakshatraMode === 'known' && nakshatra) nakshatraName = nakshatra + ' (selected by you)';
    const md = astro.vedic.dasha && astro.vedic.dasha.mahaDasha ? astro.vedic.dasha.mahaDasha : null;
    const dashaText = md && md.lord ? ', with ' + md.lord + ' Maha Dasha active' : '';
    const timingText = md && md.lord
      ? 'The available timing data only shows the current ' + md.lord + ' Maha Dasha' + (Number.isFinite(md.balanceYears) ? ' with about ' + md.balanceYears + ' years of balance' : '') + '; it does not include enough event-specific transit or sub-period dating to name a reliable calendar window.'
      : '';
    return {
      label: 'Vedic chart',
      text: 'your Vedic chart shows ' + rashi + ' Rashi' + (nakshatraName ? ' and ' + nakshatraName + ' Nakshatra' : '') + dashaText,
      hasTiming: Boolean(timingText),
      timingText
    };
  }

  if (tradition === 'hellenic' && astro.hellenistic) {
    const fortune = astro.hellenistic.lots && astro.hellenistic.lots.fortune ? astro.hellenistic.lots.fortune.sign : '';
    const eros = astro.hellenistic.lots && astro.hellenistic.lots.eros ? astro.hellenistic.lots.eros.sign : '';
    const sect = astro.hellenistic.sect ? astro.hellenistic.sect + ' sect' : 'sect context';
    return {
      label: 'Hellenistic chart',
      text: 'your Hellenistic chart has ' + sect + (fortune ? ' with Fortune in ' + fortune : '') + (eros ? ' and Eros in ' + eros : ''),
      hasTiming: false,
      timingText: ''
    };
  }

  const signs = astro.signs || {};
  const sun = signs.sun && signs.sun.tropical && signs.sun.tropical.sign ? signs.sun.tropical.sign : fallbackSign;
  const moon = signs.moon && signs.moon.tropical && signs.moon.tropical.sign ? signs.moon.tropical.sign : '';
  const asc = astro.ascendant && astro.ascendant.tropical && astro.ascendant.tropical.sign ? astro.ascendant.tropical.sign : '';
  const mc = astro.midheaven && astro.midheaven.tropical && astro.midheaven.tropical.sign ? astro.midheaven.tropical.sign : '';
  return {
    label: 'Western chart',
    text: 'your Western chart shows Tropical Sun in ' + sun + (moon ? ', Moon in ' + moon : '') + (asc ? ', Rising in ' + asc : '') + (mc ? ', and Midheaven in ' + mc : ''),
    hasTiming: false,
    timingText: ''
  };
}

function buildDirectSentence(intent, factors) {
  const topic = getTopicNoun(intent.topic);
  if (intent.timing) {
    if (factors.hasTiming) {
      return 'For ' + topic + ', the current implementation does not support a precise date, but it can read the active timing background from your chart.';
    }
    return 'For ' + topic + ', I cannot give a reliable date or year from the available chart data.';
  }
  return 'For ' + topic + ', the strongest supported answer comes from the chart factors available here, not from a guaranteed prediction.';
}

/**
 * Generate a deterministic answer using the template provider.
 */
function generateTemplateAnswer(params) {
  const question = params.question || '';
  const sign = getZodiacSign(params.dob);
  const astro = params.astrologyData;
  const tradition = params.tradition || 'western';
  const intent = params.questionIntent || classifyQuestionIntent(question);
  const factors = getTraditionFactors(astro, tradition, sign, params.nakshatraMode, params.nakshatra);
  const topic = getTopicNoun(intent.topic);

  var parts = [];
  parts.push('<p class="reading-paragraph"><strong>Answer:</strong> ' + escapeHtml(buildDirectSentence(intent, factors)) + '</p>');

  var topicSentence;
  if (intent.topic === 'career/job') {
    topicSentence = 'Read specifically for career, this points to practical momentum through focus, preparation, and the professional indicators already present in ' + factors.text + '.';
  } else if (intent.topic === 'money') {
    topicSentence = 'Read specifically for money, this favors steadier financial choices over risky leaps, using the temperament shown by ' + factors.text + '.';
  } else if (intent.topic === 'marriage') {
    topicSentence = 'Read specifically for marriage, this emphasizes partnership readiness and emotional consistency through ' + factors.text + '.';
  } else if (intent.topic === 'relationship/love') {
    topicSentence = 'Read specifically for love, this points to clearer communication and a relationship pattern shaped by ' + factors.text + '.';
  } else if (intent.topic === 'intimacy') {
    topicSentence = 'Read professionally for intimacy, this is best understood as timing around trust, emotional readiness, and mutual respect, reflected through ' + factors.text + '.';
  } else if (intent.topic === 'education') {
    topicSentence = 'Read specifically for education, this supports disciplined learning and decisions that match the mental rhythm shown by ' + factors.text + '.';
  } else if (intent.topic === 'travel/relocation') {
    topicSentence = 'Read specifically for travel or relocation, this suggests movement is most supportive when it is planned around stability rather than escape, based on ' + factors.text + '.';
  } else if (intent.topic === 'family') {
    topicSentence = 'Read specifically for family, this highlights patience, boundaries, and emotional steadiness through ' + factors.text + '.';
  } else if (intent.topic === 'compatibility') {
    topicSentence = 'For compatibility, this chart can describe your needs and style, but it cannot fully judge another person without their birth context; your side is shown by ' + factors.text + '.';
  } else {
    topicSentence = 'The available chart context for this question is ' + factors.text + '.';
  }

  parts.push('<p class="reading-paragraph">' + escapeHtml(topicSentence) + '</p>');

  if (intent.timing) {
    const timingSentence = factors.timingText || 'This implementation has natal chart factors but not enough supported timing technique data, such as exact transit windows or complete dated sub-periods, to derive a trustworthy calendar period.';
    parts.push('<p class="reading-paragraph">' + escapeHtml(timingSentence) + '</p>');
  }

  parts.push('<p class="reading-paragraph">This is an astrology-based interpretation for entertainment and reflection, so treat it as guidance rather than a guaranteed outcome.</p>');

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
