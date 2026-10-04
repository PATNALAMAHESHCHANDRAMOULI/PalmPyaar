/**
 * PalmPyaar Ask-Question API â€” POST /api/ask-question
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
const intentClassifier = require('../lib/questionIntent');
const answerContract = require('../providers/answerContract');
const followupQualityGate = require('../providers/followupQualityGate');

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
    // but focused on the specific question asked. The intent is resolved
    // semantically (lib/questionIntent) and selects both the evidence topic
    // and the answer structure (providers/answerContract).
    let answer;
    const questionIntentResult = intentClassifier.classifyQuestion(question);
    const questionIntent = {
      topic: questionIntentResult.topic || 'general',
      timing: questionIntentResult.timing === true,
      name: questionIntentResult.name,
      domain: questionIntentResult.domain,
      label: questionIntentResult.label,
      inScope: questionIntentResult.inScope,
      outOfScopeKind: questionIntentResult.outOfScopeKind,
      adult: questionIntentResult.adult,
      evaluation: questionIntentResult.evaluation,
      descriptive: questionIntentResult.descriptive
    };
    const timingContext = questionIntent.topic === 'name-meaning'
      ? { supported: false, topic: questionIntent.topic }
      : timingEngine.deriveTimingWindow({
        astrologyData: astrologyData,
        tradition: tradition,
        dob: dob,
        intent: questionIntent
      });
    const nameMeaningContext = questionIntent.domain === 'NAME_MEANING'
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

/**
 * Deterministic, intent-adaptive answer builder.
 *
 * This is both the non-AI path (AI_READING=false) and the safe fallback used
 * whenever the AI answer fails providers/followupQualityGate. It renders the
 * same section plan the AI is given, so a customer never sees a structurally
 * different answer depending on which path produced it.
 *
 * The plan comes from providers/answerContract.resolveSections(), which means
 * the structure adapts to the question: a personality question never gets a
 * timing window, and an out-of-scope question never gets astrology at all.
 */

/** Direct, human-first answers per domain. These lead with the actual answer. */
const DOMAIN_DIRECT = {
  YEARLY_OUTLOOK: 'This year reads more like a building year than a breakthrough year for you. It is not a difficult stretch, but it rewards steady progress, skill-building and finishing what you have started more than sudden openings.',
  GENERAL: 'Your reading supports a constructive answer here, and the detail below explains what that looks like for your chart specifically.',
  CAREER: 'Your career and your next job look workable and capable of real movement, but the chart rewards steady, visible effort more than one dramatic leap. Preparation is your strongest lever right now.',
  MONEY: 'Your chart supports steadier financial growth than big gambles. Consistent saving and building a skill that pays will do more for you this period than any risky move.',
  LOVE: 'Love and relationship are genuinely open to you, and the pattern improves when you say what you want directly rather than waiting for it to be obvious.',
  MARRIAGE: 'Marriage is genuinely supported by your chart. What matters most is that your own emotional readiness matches the timing, rather than the timing alone.',
  OPPORTUNITIES: 'Your chart supports real opportunity here, and good opportunities arrive most reliably through preparation you have already done rather than a sudden break.',
  INTIMACY: 'This period looks more romantically open than your quieter ones, and readiness seems to be growing for you rather than fading.',
  PERSONALITY: 'You come across as someone more self-directed than your doubt suggests, with a real instinct for reading a room and a genuine need to be taken seriously.',
  EMOTIONAL_PATTERNS: 'What you are describing is a pattern rather than a flaw, and it is one you can shift. The overthinking tends to run when you are tired and under pressure, not because something is fundamentally wrong.',
  EDUCATION: 'Study and learning look genuinely favourable to you right now, and regular structured work will outperform bursts of effort.',
  CREATIVITY: 'Your creative instinct is more available than you may be giving it credit for, and the chart favours actually starting rather than perfecting the idea first.',
  SOCIAL_LIFE: 'Your social life can genuinely improve, and the chart suggests this happens more through consistent, low-pressure contact than through grand gestures.',
  FAMILY: 'Family relationships look workable and can ease, especially where you are patient and clear about what you need.',
  CHILDREN: 'Your chart carries real nurturing capacity here, and the timing tends to follow life stability rather than a fixed age.',
  TRAVEL: 'A relocation or a longer stretch abroad is genuinely supported by your chart, and it works best when it is planned around opportunity rather than escape.',
  LIFE_DIRECTION: 'You are closer to a real decision point than it feels. Your chart favours choosing one direction and going deep rather than keeping every option open.',
  DIFFICULT_PHASE: 'Yes, this is a genuinely difficult phase, and it is not permanent. It is asking for patience and adjustment more than a dramatic course correction.',
  NAME_MEANING: null
};

/** What the evidence says, in plain language, per domain. */
const DOMAIN_EVIDENCE = {
  YEARLY_OUTLOOK: 'Your timing favours periods that consolidate rather than launch, so the near term rewards groundwork and the bigger openings arrive further out.',
  GENERAL: 'Your chart shows a stable overall configuration, which tends to reward consistent effort more than lucky timing.',
  CAREER: 'Your career houses and significators point to steady professional building being the reliable route this period.',
  MONEY: 'Your second-house and money significators favour accumulation over speculation.',
  LOVE: 'Your relationship houses and Venus-linked periods indicate that connection improves through warmth and directness.',
  MARRIAGE: 'Your seventh and fifth house activations, along with your Venus and Jupiter significators, are the areas that govern when partnership is most likely to settle.',
  OPPORTUNITIES: 'Your eleventh and tenth house activations, with Jupiter and Sun significators, are the areas that govern when gains and new opportunities become available.',
  INTIMACY: 'Your eighth-house and Venus-Mars indications suggest openness to closeness that grows with trust.',
  PERSONALITY: 'Your sun, moon and rising placements describe a fairly consistent core temperament.',
  EMOTIONAL_PATTERNS: 'Your moon sign and current emotional cycle suggest a period where the mind is busier than the situation requires.',
  EDUCATION: 'Your fifth and ninth house activations favour learning and concentrated study.',
  CREATIVITY: 'Your fifth-house activation favours creative output that actually gets finished and shown.',
  SOCIAL_LIFE: 'Your eleventh-house indicators point to friendships and networks being genuinely improvable.',
  FAMILY: 'Your fourth-house activation favours domestic and family steadiness.',
  CHILDREN: 'Your fifth and eleventh house indications point to family growth aligning with stability.',
  TRAVEL: 'Your ninth and twelfth house indicators favour movement, foreign connection and settling elsewhere.',
  LIFE_DIRECTION: 'Your tenth and first house activations favour a visible, deliberate change of direction.',
  DIFFICULT_PHASE: 'Your current period activates heavier houses, which is why it feels demanding rather than because anything is fundamentally wrong.'
};

/** Practical, human themes per domain. */
const DOMAIN_MEANING = {
  GENERAL: 'Expect things to move at the pace of your own consistency rather than on anyone else\'s schedule.',
  CAREER: 'Expect progress to build in stages. Visible effort, finished work and clear communication carry the most weight right now.',
  MONEY: 'Expect steadier gains from consistent habits than from one-off risks. Discipline compounds most over the period ahead.',
  LOVE: 'Expect closeness to deepen when communication is honest and direct. Avoid reading silence as rejection.',
  MARRIAGE: 'Expect the strongest movement when the window aligns with your own readiness. The chart rewards emotional consistency over pressure.',
  OPPORTUNITIES: 'Expect doors to open where you have been preparing. Timing most favours those already in motion.',
  INTIMACY: 'Expect closeness to grow as trust grows, and to grow fastest when nobody is performing.',
  PERSONALITY: 'Expect your natural style to become clearer the more you work with it rather than against it.',
  EMOTIONAL_PATTERNS: 'Expect the pattern to loosen when you give it structure rather than fighting it. One thing at a time, and enough sleep, genuinely help.',
  EDUCATION: 'Expect the best results from regular, structured study. Consistency beats last-minute effort here.',
  CREATIVITY: 'Expect the work to come when you make it, not when you feel inspired. Volume first, polish later.',
  SOCIAL_LIFE: 'Expect friendships to improve through repetition rather than intensity. The same people, more often.',
  FAMILY: 'Expect warmth to return through patience and clear boundaries. Small consistent gestures matter most.',
  CHILDREN: 'Expect family growth to align best with life stability. Readiness matters more than a fixed age.',
  TRAVEL: 'Expect a travel move, or a longer stretch abroad, to work best when it is planned around opportunity rather than escape. Timing and preparation matter far more than luck here.',
  LIFE_DIRECTION: 'Expect clarity to arrive through action, not waiting. Small aligned steps reveal the path.',
  DIFFICULT_PHASE: 'Expect this stretch to feel demanding but temporary. The pressure eases as you adjust your approach.',
  YEARLY_OUTLOOK: 'Expect this period to reward the unglamorous work: skills, systems, finishing, and getting clear on where you are going.'
};

/** What a mixed or weaker period is genuinely good for. */
const PERIOD_FAVORS = 'It favours building rather than breaking things, finishing rather than starting, and getting genuinely clear on what you want before you commit to it.';
const PERIOD_ASKS = 'It asks for patience with the pace and honesty about what is actually draining you. Nothing here needs a dramatic correction.';

const DOMAIN_BOTTOM_LINE = {
  GENERAL: 'The strongest gains come from your own consistency rather than from timing.',
  CAREER: 'Your career moves at the speed of your preparation, and that pace is working for you.',
  MONEY: 'Steady and deliberate is the winning financial strategy for this period.',
  LOVE: 'The relationship opportunity here is real, and honesty is what opens it.',
  MARRIAGE: 'Partnership is genuinely on the table for you, and the timing favors doing it from a place of readiness rather than pressure.',
  OPPORTUNITIES: 'The opportunity is real, and preparation is what converts it into something you can actually keep.',
  INTIMACY: 'This period is more romantically open than your quieter ones, and that is genuinely a good sign.',
  PERSONALITY: 'You have more substance in you than your self-doubt suggests.',
  EMOTIONAL_PATTERNS: 'This is a pattern you can work with, not a verdict on you.',
  EDUCATION: 'Focused effort will convert into real results for you this period.',
  CREATIVITY: 'Your creative work is worth finishing and putting in front of people.',
  SOCIAL_LIFE: 'Connection gets easier the more often you let it happen.',
  FAMILY: 'Family relationships can genuinely ease this period.',
  CHILDREN: 'Family growth is supported when the rest of life is reasonably stable.',
  TRAVEL: 'A well-planned move or foreign chapter is genuinely supported.',
  LIFE_DIRECTION: 'Choose one direction and commit; keeping every option open is the expensive part.',
  DIFFICULT_PHASE: 'This is heavy but it is not permanent, and it is teaching you something useful.',
  YEARLY_OUTLOOK: 'This year is worth doing properly rather than dramatically, and a stronger window sits further out.'
};

/**
 * Answers for descriptive ("what kind of", "who am I like") questions, which
 * ask what something is LIKE rather than WHEN it happens.
 */
const DOMAIN_DESCRIPTIVE = {
  LOVE: 'Your chart points toward a partner who is steady and emotionally dependable rather than dramatic or unpredictable. Warmth and reliability matter to you more than status, and you are drawn to someone you can be unguarded around. You are more likely to feel drawn to someone patient than to someone who creates immediate intensity.',
  GENERAL: 'Reading the shape of your chart, the pattern is steadier and more considered than impulsive. You make your strongest moves once you have understood a situation rather than while you are still reacting to it.',
  PERSONALITY: 'You read a room quickly and settle on a position before most people have formed one. There is a composed, self-contained quality to how you come across, which is why people often underestimate how much you are actually processing.',
  EMOTIONAL_PATTERNS: 'Your inner life runs deeper than you usually advertise. You process things internally first and only then decide what to say, which is why your quiet periods are usually productive rather than empty.',
  CAREER: 'Your chart suits work where judgement and consistency matter more than constant novelty. You do best where you can build something properly rather than constantly switching environments.',
  CREATIVITY: 'Your creative instinct is more disciplined than spontaneous. You work best with enough structure around you that the idea gets finished instead of endlessly refined.',
  SOCIAL_LIFE: 'You build friendships slowly and keep them. You are more likely to have a few people you rely on heavily than a wide circle, and that is not a weakness.',
  TRAVEL: 'You are drawn to places that let you start over rather than to places that offer more of the same. The move has to feel like a genuine reset, not just a change of scenery.',
  FAMILY: 'You care about your family more than you show, and you tend to handle it by being dependable rather than expressive. That is noticed later than it should be.',
  MONEY: 'You are not driven by display, but you are sensitive to not being able to stand on your own two feet. Security, not luxury, is what your chart actually wants.',
  LIFE_DIRECTION: 'You already know roughly what matters to you; what you are still working out is how to justify it to the rest of your life.',
  DIFFICULT_PHASE: 'What you are going through suits you. It is asking you to be more honest than comfortable, which is why it feels harder than it is useful.'
};

/** Distinct copy for "WHAT THIS SAYS ABOUT YOU" so it never repeats the opener. */
const DOMAIN_SELF = {
  PERSONALITY: 'You lead with composure and a certain steadiness, and you read a situation quickly before you commit to it. Your instinct is to hold your own counsel, which protects you but does leave people guessing sometimes.',
  EMOTIONAL_PATTERNS: 'Your mind moves fast, and when you are uncertain it fills the gap with worst-case scenarios. That is not pessimism — it is an attempt to stay ahead of something you cannot control.'
};

/** Builds the plain-language "what the chart says" statement. */
function buildEvidenceSentence(factors) {
  return 'Your chart shows ' + factors.text + ', and the pattern here is steady rather than dramatic.';
}

function domainOf(intent) {
  return (intent && intent.domain) || 'GENERAL';
}

function isWindowSection(section) {
  return /WINDOW$/i.test(String(section || ''));
}

/**
 * Deterministic answer honouring the resolved section plan.
 */
function generateTemplateAnswer(params) {
  const question = params.question || '';
  const sign = getZodiacSign(params.dob);
  const astro = params.astrologyData;
  const tradition = params.tradition || 'western';
  const intent = params.questionIntent || intentClassifier.classifyQuestionIntent(question);
  const domain = domainOf(intent);
  const factors = getTraditionFactors(astro, tradition, sign, params.nakshatraMode, params.nakshatra, params.dob);
  const timing = params.timingContext || timingEngine.deriveTimingWindow({
    astrologyData: astro,
    tradition: tradition,
    dob: params.dob,
    intent: intent
  });

  // Out of scope: a short redirect, deliberately no astrology.
  if (intent.inScope === false) {
    return '<h4 class="answer-label">DIRECT ANSWER</h4>\n<p class="reading-paragraph">' +
      escapeHtml(answerContract.outOfScopeReply(intent)) + '</p>';
  }

  // Name meaning keeps its curated, dedicated rendering.
  if (domain === 'NAME_MEANING') {
    return buildNameMeaningTemplateAnswer(params, factors);
  }

  const plan = answerContract.resolveSections(intent, timing);
  const parts = [];

  for (let i = 0; i < plan.sections.length; i++) {
    const section = plan.sections[i];
    if (isWindowSection(section)) {
      parts.push('<h4 class="answer-label">' + escapeHtml(section) + '</h4>');
      parts.push('<p class="answer-window">' + escapeHtml(timing.window.text) + '</p>');
      continue;
    }

    let body = '';
    switch (String(section).toUpperCase()) {
      case 'DIRECT ANSWER':
        body = (intent.descriptive && DOMAIN_DESCRIPTIVE[domain]) || DOMAIN_DIRECT[domain] || DOMAIN_DIRECT.GENERAL;
        break;
      case 'WHY THIS SHOWS UP':
        body = buildEvidenceSentence(factors) + ' ' + (DOMAIN_EVIDENCE[domain] || DOMAIN_EVIDENCE.GENERAL);
        break;
      case 'WHAT THIS MEANS FOR YOU':
        body = DOMAIN_MEANING[domain] || DOMAIN_MEANING.GENERAL;
        break;
      case 'WHAT THIS PERIOD FAVORS':
        body = PERIOD_FAVORS;
        break;
      case 'WHAT THIS PERIOD ASKS OF YOU':
        body = PERIOD_ASKS;
        break;
      case 'WHAT THIS PERIOD IS ASKING OF YOU':
        body = PERIOD_ASKS;
        break;
      case 'WHAT THIS SAYS ABOUT YOU':
        body = DOMAIN_SELF[domain] || (intent.descriptive && DOMAIN_DESCRIPTIVE[domain]) ||
          DOMAIN_DIRECT[domain] || DOMAIN_DIRECT.GENERAL;
        break;
      case 'WHAT TO WORK WITH':
        body = DOMAIN_MEANING[domain] || DOMAIN_MEANING.GENERAL;
        break;
      case 'STRONGER WINDOW':
        body = 'A stronger window sits around ' + escapeHtml(timing.window.text) +
          ', and this period is best used to prepare for it rather than to rush it.';
        break;
      case 'BOTTOM LINE':
        body = DOMAIN_BOTTOM_LINE[domain] || DOMAIN_BOTTOM_LINE.GENERAL;
        break;
      default:
        body = DOMAIN_MEANING[domain] || DOMAIN_MEANING.GENERAL;
    }

    if (body) {
      parts.push('<h4 class="answer-label">' + escapeHtml(section) + '</h4>');
      parts.push('<p class="reading-paragraph">' + escapeHtml(body) + '</p>');
    }
  }

  return parts.join('\n');
}

function buildNameMeaningTemplateAnswer(params, factors) {
  const fallbackName = params.name || '';
  const intent = params.questionIntent || {};
  const context = params.nameMeaningContext ||
    nameMeaning.buildNameMeaningContext(intent.name || fallbackName);

  const parts = [];
  parts.push('<h4 class="answer-label">DIRECT ANSWER</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml(context.summary) + '</p>');

  parts.push('<h4 class="answer-label">WHAT THE NAME CARRIES</h4>');
  if (context.recognized) {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The meaning of ' + context.name + ' â€” ' + context.themes + ' â€” blends with ' + factors.text + '. Names carry the themes we often grow into, and the chart describes how those themes tend to express in your life.') + '</p>');
  } else if (context.number) {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The name-number theme blends with ' + factors.text + '. A name number of ' + context.number + ' points to ' + nameMeaning.themeForNumber(context.number) + ', which the chart shows expressing through your core factors.') + '</p>');
  } else {
    parts.push('<p class="reading-paragraph">' + escapeHtml('The chart itself describes ' + factors.text + ', which is the strongest reference for how you express your identity.') + '</p>');
  }

  parts.push('<h4 class="answer-label">BOTTOM LINE</h4>');
  parts.push('<p class="reading-paragraph">' + escapeHtml('Expect your identity to feel most settled when you work with the themes above rather than against them. A name reflects a pattern; the chart shows how it plays out.') + '</p>');

  return parts.join('\n');
}

/**
 * Generate an AI-powered answer using the Groq provider.
 */
async function generateAiAnswer(provider, params) {
  const question = params.question || '';

  // Deterministic answer is always built first: it is both the non-AI path and
  // the safe fallback when the AI answer fails the product quality gate.
  const templateAnswer = generateTemplateAnswer(params);

  if (!provider || typeof provider.generateAnswer !== 'function') {
    return templateAnswer;
  }

  try {
    const result = await provider.generateAnswer(params);
    if (result && result.answer && result.answer.trim().length > 0) {
      const verdict = followupQualityGate.evaluate(result.answer, params.questionIntent, params.timingContext);
      if (verdict.ok) {
        return result.answer;
      }
      console.warn('[ask-question] AI answer rejected by quality gate: ' + verdict.violations.join(', ') +
        ' (severity=' + verdict.severity + ' jargon=' + verdict.metrics.jargon + '/' + verdict.metrics.words + ')');
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
