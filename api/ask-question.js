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
const timingEngine = require('../lib/timingEngine');
const nameMeaning = require('../lib/nameMeaning');

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
    const timingContext = timingEngine.deriveTimingWindow({
      astrologyData: astrologyData,
      tradition: tradition,
      dob: dob,
      intent: questionIntent
    });
    const nameMeaningContext = questionIntent.topic === 'name-meaning'
      ? nameMeaning.buildNameMeaningContext(questionIntent.name || name)
      : null;
    if (useAi && process.env.GROQ_API_KEY) {
      answer = await generateAiAnswer(provider, { name, dob, birthTime, birthplace, tradition, photoHash, palmEvidence, astrologyData, question, questionIntent, nakshatraMode, nakshatra, timingContext, nameMeaningContext });
    } else {
      answer = generateTemplateAnswer({ name, dob, birthTime, birthplace, tradition, astrologyData, question, questionIntent, nakshatraMode, nakshatra, timingContext, nameMeaningContext });
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
 * Identify the user's follow-up intent. This is used internally only to keep
 * deterministic fallback answers focused on the actual question.
 */
function classifyQuestionIntent(question) {
  const q = String(question || '').toLowerCase();
  const intent = {
    topic: 'general',
    timing: /\b(when|date|year|age|month|how soon|time|timing|window)\b/.test(q),
    name: null
  };

  // Name-meaning questions are answered from the curated name lexicon.
  if (/\bname\b/.test(q) && /\b(mean|meaning|significance|origin)\b/.test(q)) {
    intent.topic = 'name-meaning';
    intent.name = extractNameFromQuestion(q) || null;
    return intent;
  }

  if (/\b(personality|character|temperament|nature|who am i|describe me|inner self)\b/.test(q)) intent.topic = 'personality';
  else if (/\b(job|career|work|promotion|interview|profession|business|employment)\b/.test(q)) intent.topic = 'career/job';
  else if (/\b(money|wealth|income|salary|finance|financial|rich|debt)\b/.test(q)) intent.topic = 'money';
  else if (/\b(marriage|married|spouse|husband|wife|wedding)\b/.test(q)) intent.topic = 'marriage';
  else if (/\b(relationship|love|partner|girlfriend|boyfriend|dating|romance|meet someone|meet|crush|soulmate)\b/.test(q)) intent.topic = 'relationship/love';
  else if (/\b(virginity|sex|intimacy|intimate|physical closeness)\b/.test(q)) intent.topic = 'intimacy';
  else if (/\b(education|study|studies|exam|college|university|degree|school)\b/.test(q)) intent.topic = 'education';
  else if (/\b(travel|abroad|foreign|relocation|relocate|move|migration|overseas)\b/.test(q)) intent.topic = 'travel/relocation';
  else if (/\b(children|child|baby|kids|progeny)\b/.test(q)) intent.topic = 'children';
  else if (/\b(family|parents|mother|father|sibling)\b/.test(q)) intent.topic = 'family';
  else if (/\b(difficult|hard phase|challenging|tough period|bad time|struggle|difficulty|obstacle|low phase)\b/.test(q)) intent.topic = 'difficult-phase';
  else if (/\b(life direction|purpose|path|what should i do|direction|career change|change my life|next chapter)\b/.test(q)) intent.topic = 'life-direction';
  else if (/\b(opportunit|future|next steps|luck|good time|good things|success|successful|succeed|achieve)\b/.test(q)) intent.topic = 'opportunities/future';
  else if (/\b(compatible|compatibility|match|synastry)\b/.test(q)) intent.topic = 'compatibility';

  return intent;
}

function extractNameFromQuestion(q) {
  const patterns = [
    /\bwhat does (?:my |the )?name ([a-z][a-z']{0,29}) mean\b/,
    /\bwhat does ([a-z][a-z']{0,29}) mean\b/,
    /\bmeaning of (?:the )?(?:name )?([a-z][a-z']{0,29})\b/,
    /\bmy name is ([a-z][a-z']{0,29})\b/
  ];
  for (const re of patterns) {
    const m = String(q).match(re);
    if (m && m[1] && m[1].length >= 2) return m[1];
  }
  return null;
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
    case 'children': return 'children and family growth';
    case 'compatibility': return 'compatibility';
    case 'personality': return 'your core personality';
    case 'name-meaning': return 'your name meaning';
    case 'difficult-phase': return 'the current difficult phase';
    case 'life-direction': return 'your life direction';
    case 'opportunities/future': return 'opportunities and future prospects';
    default: return 'your question';
  }
}

function getTraditionFactors(astro, tradition, fallbackSign, nakshatraMode, nakshatra, dob) {
  if (!astro || typeof astro !== 'object') {
    return {
      label: 'birth-sign context',
      text: 'your ' + fallbackSign + ' birth-sign context',
      signs: {}
    };
  }

  if (tradition === 'vedic' && astro.vedic) {
    const rashi = astro.vedic.rashi && astro.vedic.rashi.sign ? astro.vedic.rashi.sign : fallbackSign;
    var nakshatraName = astro.vedic.nakshatra && astro.vedic.nakshatra.name ? astro.vedic.nakshatra.name : '';
    if (nakshatraMode === 'known' && nakshatra) nakshatraName = nakshatra + ' (selected by you)';
    const md = astro.vedic.dasha && astro.vedic.dasha.mahaDasha ? astro.vedic.dasha.mahaDasha : null;
    var currentPeriodText = '';
    try {
      const birthYear = parseInt(String(dob || '').slice(0, 4), 10);
      if (md && !isNaN(birthYear)) {
        const schedule = timingEngine.buildVedicSchedule(astro.vedic.dasha, birthYear, Date.now());
        if (schedule && schedule.currentMD) {
          currentPeriodText = ' with ' + (schedule.currentMD.lord.charAt(0).toUpperCase() + schedule.currentMD.lord.slice(1)) + ' Mahadasha active' +
            (schedule.currentAD ? ' and ' + (schedule.currentAD.lord.charAt(0).toUpperCase() + schedule.currentAD.lord.slice(1)) + ' Antardasha' : '');
        }
      }
    } catch (err) { /* non-fatal: fall back to birth dasha wording */ }
    const dashaText = md && md.lord && !currentPeriodText ? ', with ' + (md.lord.charAt(0).toUpperCase() + md.lord.slice(1)) + ' Maha Dasha active' : currentPeriodText;
    const sunPlanet = astro.planets && astro.planets.Sun;
    return {
      label: 'Vedic chart',
      text: rashi + ' Rashi' + (nakshatraName ? ' and ' + nakshatraName + ' Nakshatra' : '') + dashaText + ' in your Vedic chart',
      signs: {
        sun: sunPlanet && sunPlanet.sidereal && sunPlanet.sidereal.sign ? sunPlanet.sidereal.sign : rashi,
        moon: rashi,
        rising: astro.vedic.lagna && astro.vedic.lagna.sign ? astro.vedic.lagna.sign : (astro.ascendant && astro.ascendant.sidereal && astro.ascendant.sidereal.sign ? astro.ascendant.sidereal.sign : ''),
        midheaven: astro.midheaven && astro.midheaven.sidereal && astro.midheaven.sidereal.sign ? astro.midheaven.sidereal.sign : ''
      }
    };
  }

  if (tradition === 'hellenic' && astro.hellenistic) {
    const fortune = astro.hellenistic.lots && astro.hellenistic.lots.fortune ? astro.hellenistic.lots.fortune.sign : '';
    const eros = astro.hellenistic.lots && astro.hellenistic.lots.eros ? astro.hellenistic.lots.eros.sign : '';
    const sect = astro.hellenistic.sect ? astro.hellenistic.sect : 'sect context';
    const sunPlanet = astro.planets && astro.planets.Sun;
    const moonPlanet = astro.planets && astro.planets.Moon;
    return {
      label: 'Hellenistic chart',
      text: 'the ' + sect + (fortune ? ' with Fortune in ' + fortune : '') + (eros ? ' and Eros in ' + eros : '') + ' in your Hellenistic chart',
      signs: {
        sun: sunPlanet && sunPlanet.sidereal && sunPlanet.sidereal.sign ? sunPlanet.sidereal.sign : '',
        moon: moonPlanet && moonPlanet.sidereal && moonPlanet.sidereal.sign ? moonPlanet.sidereal.sign : '',
        rising: astro.ascendant && astro.ascendant.sidereal && astro.ascendant.sidereal.sign ? astro.ascendant.sidereal.sign : '',
        midheaven: astro.midheaven && astro.midheaven.sidereal && astro.midheaven.sidereal.sign ? astro.midheaven.sidereal.sign : ''
      }
    };
  }

  const signs = astro.signs || {};
  const sun = signs.sun && signs.sun.tropical && signs.sun.tropical.sign ? signs.sun.tropical.sign : fallbackSign;
  const moon = signs.moon && signs.moon.tropical && signs.moon.tropical.sign ? signs.moon.tropical.sign : '';
  const asc = astro.ascendant && astro.ascendant.tropical && astro.ascendant.tropical.sign ? astro.ascendant.tropical.sign : '';
  const mc = astro.midheaven && astro.midheaven.tropical && astro.midheaven.tropical.sign ? astro.midheaven.tropical.sign : '';
  return {
    label: 'Western chart',
    text: 'the Tropical Sun in ' + sun + (moon ? ', Moon in ' + moon : '') + (asc ? ', Rising in ' + asc : '') + (mc ? ', and Midheaven in ' + mc : '') + ' in your Western chart',
    signs: {
      sun: sun,
      moon: moon,
      rising: asc,
      midheaven: mc
    }
  };
}

const SHORT_NOUNS = {
  'career/job': 'career',
  'money': 'financial',
  'education': 'study',
  'marriage': 'marriage',
  'relationship/love': 'relationship',
  'intimacy': 'intimacy',
  'family': 'family',
  'children': 'family',
  'travel/relocation': 'relocation',
  'personality': 'personal',
  'life-direction': 'life-direction',
  'opportunities/future': 'opportunity',
  'compatibility': 'partnership',
  'general': 'outlook',
  'difficult-phase': 'phase'
};

const DIRECT_ANSWERS = {
  'career/job': 'Your chart shows real professional momentum. The strongest supported reading is that steady, prepared effort carries the most weight right now.',
  'money': 'Your chart supports steadier financial growth than big risks. Consistent saving and skill-building look like the strongest levers.',
  'marriage': 'Marriage is strongly supported in your chart. The strongest reading is that partnership works best when emotional readiness and the calendar align.',
  'relationship/love': 'Your chart points to relationship growth through clearer communication. The pattern improves when needs are expressed directly.',
  'intimacy': 'For intimacy, the strongest supported reading is that readiness grows through trust and mutual respect rather than pressure.',
  'education': 'Your chart supports disciplined study. Consistent effort is the strongest factor for exam and degree success.',
  'travel/relocation': 'Your chart supports a well-planned relocation abroad. It looks strongest when built on preparation rather than escape.',
  'family': 'Your chart points to family stability through patience and clear boundaries.',
  'children': 'Your chart shows strong nurturing potential. The strongest reading ties timing to life stability rather than a fixed age.',
  'personality': 'Your chart describes your core temperament; the strongest factors are shown below.',
  'life-direction': 'Your chart points to a meaningful shift in direction. The strongest supported reading favors choosing depth over speed.',
  'opportunities/future': 'Your chart shows promising opportunities ahead. The strongest supported reading is that preparation raises the odds.',
  'compatibility': 'Your chart describes your partnership needs clearly. It cannot fully judge another person without their own birth data.',
  'difficult-phase': 'Your chart does indicate a difficult phase right now, but not a permanent one. The strongest supported reading is that this stretch asks for patience and adjustment, and it does lift.',
  'general': 'Your chart supports a favorable reading of this question. The strongest factors are described below.'
};

const EXPECT_ANSWERS = {
  'career/job': 'Expect progress to build in stages rather than one dramatic leap. Preparation and visible effort are what the chart rewards most.',
  'money': 'Expect steadier gains from consistent habits than from one-off risks. Discipline compounds the most over the period ahead.',
  'marriage': 'Expect the strongest movement when the window aligns with your own readiness. The chart rewards emotional consistency over pressure.',
  'relationship/love': 'Expect closeness to deepen when communication is honest and direct. Avoid reading silence as rejection.',
  'intimacy': 'Expect intimacy to grow as trust does. The healthiest path is mutual comfort, consent, and unhurried connection.',
  'education': 'Expect the best results from regular, structured study. Consistency beats last-minute effort here.',
  'travel/relocation': 'Expect the move to work best when it is planned around opportunity rather than escape. Timing and preparation matter more than luck.',
  'family': 'Expect warmth to return through patience and clear boundaries. Small consistent gestures matter most.',
  'children': 'Expect family growth to align best with life stability. Readiness matters more than a fixed age.',
  'personality': 'Expect your natural style to become clearer as you work with it rather than against it.',
  'life-direction': 'Expect clarity to arrive through action, not waiting. Small aligned steps reveal the path.',
  'opportunities/future': 'Expect doors to open where you have been preparing. Timing favors those already in motion.',
  'compatibility': 'Expect partnership to work best when your needs and a partner\'s needs are both voiced. A chart cannot speak for the other person.',
  'difficult-phase': 'Expect the difficult phase to feel demanding but temporary. The chart shows the pressure easing as you adjust your approach.',
  'general': 'Expect the pattern described above to unfold gradually, with the strongest results where you apply the most consistent effort.'
};

const OUTLOOK_ANSWERS = {
  'career/job': 'The outlook is supportive for steady advancement through the period ahead.',
  'money': 'The outlook favors building reserves and skills; patience is your strongest asset.',
  'marriage': 'The outlook for partnership is positive, with the strongest potential around the window shown above.',
  'relationship/love': 'The relationship outlook improves as communication improves.',
  'intimacy': 'The outlook favors deeper closeness as trust and comfort grow.',
  'education': 'The study outlook is favorable with disciplined focus.',
  'travel/relocation': 'The relocation outlook is favorable for a well-prepared move.',
  'family': 'The family outlook brightens with patience and steady presence.',
  'children': 'The family outlook is favorable when life is stable enough to welcome growth.',
  'personality': 'The self-understanding outlook is strong; the more you work with your natural style, the clearer life choices become.',
  'life-direction': 'The direction outlook clears as you take consistent, aligned action.',
  'opportunities/future': 'The future outlook is positive; preparation is the multiplier.',
  'compatibility': 'The compatibility outlook depends on mutual effort; your side is well-described by the chart.',
  'difficult-phase': 'The phase outlook is temporary — the chart shows the heaviest stretch easing within the period ahead.',
  'general': 'The overall outlook is constructive; the strongest gains follow your most consistent effort.'
};

function buildDirectAnswer(intent, factors, timing) {
  const topic = getTopicNoun(intent.topic);
  if (intent.timing && timing && timing.supported) {
    const shortNoun = SHORT_NOUNS[intent.topic] || topic;
    return 'For ' + topic + ', your strongest ' + shortNoun + ' window appears around ' + timing.window.text +
      '. It is derived from the alignment of timing indicators in your chart, not a fixed promise.';
  }
  if (intent.timing) {
    return 'For ' + topic + ', the available chart data gives a clear direction but no specific calendar year, so the strongest answer is the interpretation below.';
  }
  if (intent.topic === 'personality' && factors.signs.sun && factors.signs.rising) {
    return 'Your chart describes a core ' + factors.signs.sun + ' temperament, presented to the world through a ' +
      factors.signs.rising + ' style. It is a picture of how your inner and outer energy blend, not a fixed label.';
  }
  return DIRECT_ANSWERS[intent.topic] || DIRECT_ANSWERS.general;
}

function buildWhySentence(intent, factors) {
  return 'The chart shows ' + factors.text + '.';
}

function buildExpectSentence(intent) {
  return EXPECT_ANSWERS[intent.topic] || EXPECT_ANSWERS.general;
}

function buildOutlookSentence(intent) {
  return OUTLOOK_ANSWERS[intent.topic] || OUTLOOK_ANSWERS.general;
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
  const factors = getTraditionFactors(astro, tradition, sign, params.nakshatraMode, params.nakshatra, params.dob);
  const timing = params.timingContext || timingEngine.deriveTimingWindow({
    astrologyData: astro,
    tradition: tradition,
    dob: params.dob,
    intent: intent
  });

  if (intent.topic === 'name-meaning') {
    return buildNameMeaningTemplateAnswer(params, factors);
  }

  var parts = [];

  parts.push('<h4 class="answer-label">DIRECT ANSWER</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(buildDirectAnswer(intent, factors, timing)) + '</p>');

  if (intent.timing) {
    if (timing && timing.supported) {
      parts.push('<h4 class="answer-label">' + escapeHtml(timing.label) + '</h4>');
      parts.push('<p class="answer-window">' + escapeHtml(timing.window.text) + '</p>');
      parts.push('<h4 class="answer-label">WHY THIS PERIOD STANDS OUT</h4>');
      var whyPeriod = escapeHtml(timing.reasoning) + ' This is the strongest alignment the chart shows for this question, not a fixed promise.';
      if (timing.indicators && timing.indicators.length > 1) {
        whyPeriod += ' ' + escapeHtml(timing.indicators[1]) + '.';
      }
      parts.push('<p class="reading-paragraph">' + whyPeriod + '</p>');
    } else {
      parts.push('<p class="reading-paragraph">The available chart data for this question does not reach a specific calendar year, so the reading below focuses on the strongest supported interpretation.</p>');
    }
  }

  parts.push('<h4 class="answer-label">WHY YOUR CHART SHOWS THIS</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(buildWhySentence(intent, factors)) + '</p>');

  parts.push('<h4 class="answer-label">WHAT TO EXPECT</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(buildExpectSentence(intent)) + '</p>');

  parts.push('<h4 class="answer-label">OUTLOOK</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(buildOutlookSentence(intent)) + '</p>');

  return parts.join('\n');
}

function buildNameMeaningTemplateAnswer(params, factors) {
  const fallbackName = params.name || '';
  const context = params.nameMeaningContext ||
    nameMeaning.buildNameMeaningContext(params.questionIntent && params.questionIntent.name ? params.questionIntent.name : fallbackName);

  var parts = [];

  parts.push('<h4 class="answer-label">DIRECT ANSWER</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(context.summary) + '</p>');

  parts.push('<h4 class="answer-label">WHY YOUR CHART SHOWS THIS</h4>');
  if (context.recognized) {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The meaning of ' + context.name + ' — ' + context.themes + ' — blends with ' + factors.text + '. Names carry the themes we often grow into, and the chart describes how those themes tend to express in your life.') + '</p>');
  } else if (context.number) {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The name-number theme blends with ' + factors.text + '. A name number of ' + context.number + ' points to ' + nameMeaning.themeForNumber(context.number) + ', which the chart shows expressing through your core factors.') + '</p>');
  } else {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The chart itself describes ' + factors.text + ', which is the strongest reference for how you express your identity.') + '</p>');
  }

  parts.push('<h4 class="answer-label">WHAT TO EXPECT</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml('Expect your identity to feel most settled when you work with the themes above rather than against them. A name reflects a pattern; the chart shows how it plays out.') + '</p>');

  parts.push('<h4 class="answer-label">OUTLOOK</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml('The outlook is positive: the more you align daily choices with your natural themes, the more cohesive life becomes.') + '</p>');

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
