/**
 * PalmPyaar Groq Provider
 * Implements the standard Provider Interface: generateReading({ name, dob, birthplace, tradition, photoHash })
 * Live Groq API integration using OpenAI SDK (Groq is OpenAI-compatible).
 */

const templateProvider = require('./templateProvider');
const { runPipeline } = require('./readingPipeline');
const { buildReviewPrompt } = require('./reviewerPromptBuilder');
const { reviewReading } = require('./reviewEngine');
const { buildRewritePrompt } = require('./rewritePromptBuilder');
const OpenAI = require('openai');

// Provider configuration. Optional env overrides (GROQ_MODEL, GROQ_BASE_URL)
// default to the current working production configuration. Read at call time so
// tests and runtime configuration changes take effect without re-requiring the
// module. GROQ_API_KEY remains the only required secret for the AI path.
function getProviderConfig() {
  return {
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
  };
}

/**
 * Parses Groq's plain text response using ONLY the required section markers:
 * ===CORE===, ===LOVE===, ===PRO===
 * No regex guessing or paragraph heuristics.
 * Returns empty strings for missing sections.
 */
function parseGroqResponse(text) {
  if (!text || typeof text !== 'string') {
    return { core: '', love: '', pro: '' };
  }

  const trimmed = text.trim();

  // Find the exact section markers
  const coreStart = trimmed.indexOf('===CORE===');
  const loveStart = trimmed.indexOf('===LOVE===');
  const proStart = trimmed.indexOf('===PRO===');

  // If any marker is missing, return empty sections
  if (coreStart === -1 || loveStart === -1 || proStart === -1) {
    return { core: '', love: '', pro: '' };
  }

  // Extract content between markers
  const coreEnd = loveStart;
  const loveEnd = proStart;
  const proEnd = trimmed.length;

  const coreContent = trimmed.slice(coreStart + '===CORE==='.length, coreEnd).trim();
  const loveContent = trimmed.slice(loveStart + '===LOVE==='.length, loveEnd).trim();
  const proContent = trimmed.slice(proStart + '===PRO==='.length, proEnd).trim();

  return {
    core: coreContent,
    love: loveContent,
    pro: proContent
  };
}

/**
 * Calls Groq AI Reviewer to critique the generated reading.
 * Returns review object or null if review fails.
 * NEVER modifies the reading - only critiques.
 */
async function callAIReviewer(client, reading, reasoningPlan, tradition, userContext) {
  try {
    // Run deterministic review first
    const reviewReport = reviewReading({ reading, reasoningPlan, tradition, userContext });
    
    // Build review prompt
    const reviewPrompt = buildReviewPrompt({
      reading,
      reasoningPlan,
      tradition,
      reviewReport,
      userContext
    });

    console.log('[groqProvider] AI Reviewer: Calling Groq for critique...');
    console.log('[groqProvider] AI Reviewer: Prompt length:', reviewPrompt.length);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const completion = await client.chat.completions.create({
      model: getProviderConfig().model,
      messages: [{ role: 'user', content: reviewPrompt }],
      temperature: 0.3, // More analytical for review
      max_completion_tokens: 1500
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const reviewText = completion.choices[0]?.message?.content || '';
    console.log('[groqProvider] AI Reviewer: Raw response length:', reviewText ? reviewText.length : 0);
    console.log('[groqProvider] AI Reviewer: Raw response preview:', reviewText ? reviewText.slice(0, 500) : 'EMPTY');

    if (!reviewText || reviewText.trim().length === 0) {
      throw new Error('Empty response from AI Reviewer');
    }

    // Parse the structured review response
    const review = parseAIReview(reviewText);
    
    // Log required metrics
    console.log('[groqProvider] AI Reviewer: Review completed');
    console.log('[groqProvider] AI Reviewer: Overall verdict:', review.overallVerdict ? 'present' : 'missing');
    console.log('[groqProvider] AI Reviewer: Strength count:', review.strengths?.length || 0);
    console.log('[groqProvider] AI Reviewer: Weakness count:', review.weaknesses?.length || 0);
    console.log('[groqProvider] AI Reviewer: Rewrite target count:', review.rewriteAdvice?.length || 0);

    return {
      deterministic: reviewReport,
      ai: review
    };

  } catch (err) {
    console.warn('[groqProvider] AI Reviewer: AI review unavailable');
    console.warn('[groqProvider] AI Reviewer: Error:', err.message);
    
    // Still return deterministic review even if AI fails
    const reviewReport = reviewReading({ reading, reasoningPlan, tradition, userContext });
    return {
      deterministic: reviewReport,
      ai: null
    };
  }
}

/**
 * Parses the AI Reviewer's structured response.
 * Expected format: STRENGTHS, WEAKNESSES, REWRITE ADVICE, OVERALL VERDICT
 */
function parseAIReview(text) {
  const trimmed = text.trim();
  
  const strengths = [];
  const weaknesses = [];
  const rewriteAdvice = [];
  let overallVerdict = '';

  // Parse STRENGTHS section
  const strengthsStart = trimmed.indexOf('STRENGTHS');
  const weaknessesStart = trimmed.indexOf('WEAKNESSES');
  const rewriteStart = trimmed.indexOf('REWRITE ADVICE');
  const verdictStart = trimmed.indexOf('OVERALL VERDICT');

  if (strengthsStart !== -1 && weaknessesStart !== -1) {
    const strengthsText = trimmed.slice(strengthsStart + 'STRENGTHS'.length, weaknessesStart).trim();
    const strengthLines = strengthsText.split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    for (const line of strengthLines) {
      strengths.push(line.slice(1).trim());
    }
  }

  if (weaknessesStart !== -1 && rewriteStart !== -1) {
    const weaknessesText = trimmed.slice(weaknessesStart + 'WEAKNESSES'.length, rewriteStart).trim();
    const weaknessLines = weaknessesText.split('\n').map(l => l.trim()).filter(l => l.startsWith('-'));
    for (const line of weaknessLines) {
      weaknesses.push(line.slice(1).trim());
    }
  }

  if (rewriteStart !== -1 && verdictStart !== -1) {
    const rewriteText = trimmed.slice(rewriteStart + 'REWRITE ADVICE'.length, verdictStart).trim();
    const rewriteLines = rewriteText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of rewriteLines) {
      rewriteAdvice.push(line);
    }
  }

  if (verdictStart !== -1) {
    const verdictText = trimmed.slice(verdictStart + 'OVERALL VERDICT'.length).trim();
    overallVerdict = verdictText.split('\n')[0].trim(); // First paragraph only
  }

  return {
    strengths,
    weaknesses,
    rewriteAdvice,
    overallVerdict
  };
}

/**
 * Calls Groq AI Rewriter to improve the reading based on review feedback.
 * Returns rewritten reading object or null if rewrite fails/skipped.
 * NEVER fails the request - returns original draft on any error.
 */
async function callAIRewriter(client, draft, review, reasoningPlan, tradition, userContext) {
  try {
    // Check if rewrite should be skipped (overall score >= 9)
    const detReview = review.deterministic || {};
    const overallScore = detReview.overallScore || 0;
    
    if (overallScore >= 9) {
      console.log('[groqProvider] AI Rewriter: Skipped - overall score >= 9 (score:', overallScore, ')');
      return null; // Signal to skip rewrite
    }

    console.log('[groqProvider] AI Rewriter: Rewrite triggered - overall score:', overallScore);

    // Build rewrite prompt
    const rewritePrompt = buildRewritePrompt({
      draft,
      reasoningPlan,
      review,
      userContext,
      tradition
    });

    console.log('[groqProvider] AI Rewriter: Prompt length:', rewritePrompt.length);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const completion = await client.chat.completions.create({
      model: getProviderConfig().model,
      messages: [{ role: 'user', content: rewritePrompt }],
      temperature: 0.4, // Balanced for editing
      max_completion_tokens: 2200
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const rewriteText = completion.choices[0]?.message?.content || '';
    console.log('[groqProvider] AI Rewriter: Raw response length:', rewriteText ? rewriteText.length : 0);
    console.log('[groqProvider] AI Rewriter: Raw response preview:', rewriteText ? rewriteText.slice(0, 500) : 'EMPTY');

    if (!rewriteText || rewriteText.trim().length === 0) {
      throw new Error('Empty response from AI Rewriter');
    }

    // Parse rewritten response using existing parser
    const rewritten = parseGroqResponse(rewriteText);
    
    // Validate all sections have content
    if (!rewritten.core || !rewritten.love || !rewritten.pro) {
      console.warn('[groqProvider] AI Rewriter: Incomplete sections in rewrite, using original draft');
      return null;
    }

    console.log('[groqProvider] AI Rewriter: Rewrite completed successfully');
    console.log('[groqProvider] AI Rewriter: Sections:', {
      coreLength: rewritten.core.length,
      loveLength: rewritten.love.length,
      proLength: rewritten.pro.length
    });

    return rewritten;

  } catch (err) {
    console.warn('[groqProvider] AI Rewriter: Rewrite failed');
    console.warn('[groqProvider] AI Rewriter: Error:', err.message);
    return null; // Return null to signal fallback to original draft
  }
}

async function generateReading(params) {
  console.log('[groqProvider] generateReading called with params:', JSON.stringify(params));
  // Read API key from environment
  const apiKey = process.env.GROQ_API_KEY;
  console.log('[groqProvider] GROQ_API_KEY present:', !!apiKey);

  // If no API key, immediately fallback to template provider (labeled)
  if (!apiKey) {
    console.warn('[groqProvider] No GROQ_API_KEY set. Returning labeled template fallback.');
    const fallback = await templateProvider.generateReading(params);
    return { ...fallback, provider: 'template', aiGenerated: false, reason: 'missing_api_key' };
  }

  // Initialize OpenAI client configured for Groq
  const client = new OpenAI({
    baseURL: getProviderConfig().baseURL,
    apiKey: apiKey
  });

  // Execute reading pipeline (Stages 1-2: Reasoning + Assembly)
  const pipeline = await runPipeline(params);
  const prompt = pipeline.compiledPrompt;
  
  console.log('[groqProvider] Pipeline status:', pipeline.status);
  console.log('[groqProvider] Pipeline version:', pipeline.metadata.pipelineVersion);
  console.log('[groqProvider] Pipeline duration:', pipeline.metadata.durationMs, 'ms');
  console.log('[groqProvider] Current stage:', pipeline.nextStage);
  console.log('[groqProvider] Reasoning central theme:', pipeline.reasoningPlan?.centralTheme);
  console.log('[groqProvider] Component count:', pipeline.reasoningPlan ? 'from pipeline' : 'N/A');
  console.log('[groqProvider] Prompt length:', prompt?.length || 0);
  
  // If pipeline not ready, fallback to template (labeled)
  if (pipeline.status !== 'ready') {
    console.warn('[groqProvider] Pipeline not ready. Returning labeled template fallback.');
    const fallback = await templateProvider.generateReading(params);
    return { ...fallback, provider: 'template', aiGenerated: false, reason: 'pipeline_not_ready' };
  }

  // Use single production model
  console.log('[groqProvider] Using model:', getProviderConfig().model);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const completion = await client.chat.completions.create({
      model: getProviderConfig().model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_completion_tokens: 2200
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const text = completion.choices[0]?.message?.content || '';
    console.log('[groqProvider] Raw Groq response length:', text ? text.length : 0);
    console.log('[groqProvider] Raw Groq response preview:', text ? text.slice(0, 500) : 'EMPTY');

    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from Groq');
    }

    // Parse response into structured sections
    const parsed = parseGroqResponse(text);
    console.log('[groqProvider] Parsed sections:', {
      coreLength: parsed.core.length,
      loveLength: parsed.love.length,
      proLength: parsed.pro.length,
      corePreview: parsed.core.slice(0, 100),
      lovePreview: parsed.love.slice(0, 100),
      proPreview: parsed.pro.slice(0, 100)
    });

    // Ensure all sections have content (fallback to template for missing sections)
    const templateReading = await templateProvider.generateReading(params);
    console.log('[groqProvider] Template reading fetched for fallback');

    const draft = {
      core: parsed.core || templateReading.core,
      love: parsed.love || templateReading.love,
      pro: parsed.pro || templateReading.pro
    };
    console.log('[groqProvider] Final draft - using template for:', {
      core: !parsed.core,
      love: !parsed.love,
      pro: !parsed.pro
    });
    console.log('[groqProvider] Groq generation successful.');

    // ==========================================
    // AI REVIEWER (Phase 11)
    // Second Groq call to critique the draft
    // ==========================================
    const userContext = {
      name: params.name,
      dob: params.dob,
      birthTime: params.birthTime || '',
      birthplace: params.birthplace,
      tradition: params.tradition,
      photoHashPresent: !!params.photoHash,
      palmEvidence: params.palmEvidence || null,
      astrologyData: params.astrologyData || null
    };

    const review = await callAIReviewer(
      client,
      draft,
      pipeline.reasoningPlan,
      params.tradition,
      userContext
    );

    // ==========================================
    // AI REWRITER (Phase 12)
    // Third Groq call to improve the reading based on review
    // ==========================================
    const rewritten = await callAIRewriter(
      client,
      draft,
      review,
      pipeline.reasoningPlan,
      params.tradition,
      userContext
    );

    // Return rewritten version if successful, otherwise original draft
    const finalReading = rewritten || draft;
    
    if (rewritten) {
      console.log('[groqProvider] Returning rewritten reading');
    } else {
      console.log('[groqProvider] Returning original draft (rewrite skipped or failed)');
    }

    // Truthful source labeling: aiGenerated is true only when the final content
    // includes genuine Groq output (writer or rewriter). fallbackSections records
    // which sections the writer failed to produce and were filled from the
    // deterministic template. A paying customer must never receive an unlabeled
    // template reading presented as AI output.
    const fallbackSections = { core: !parsed.core, love: !parsed.love, pro: !parsed.pro };
    const anyWriterSection = !!(parsed.core || parsed.love || parsed.pro);
    const aiGenerated = !!(anyWriterSection || !!rewritten);
    console.log('[groqProvider] Final reading source:', JSON.stringify({
      aiGenerated,
      fallbackSections,
      rewritten: !!rewritten
    }));

    return {
      ...finalReading,
      provider: 'groq',
      aiGenerated,
      model: getProviderConfig().model,
      fallbackSections,
      reason: aiGenerated ? undefined : 'empty_or_malformed_response'
    };

  } catch (err) {
    clearTimeout(timeoutId);

    console.error('[groqProvider] Groq generation failed. Returning labeled template fallback:', err.message || err);
    const fallback = await templateProvider.generateReading(params);
    return { ...fallback, provider: 'template', aiGenerated: false, reason: 'provider_error' };
  }
}


/**
 * Generates an answer to a follow-up question using Groq AI.
 * Returns an object with an 'answer' property containing HTML.
 * Falls back to template provider on any error.
 */
function compactPosition(pos) {
  if (!pos || !pos.sign) return null;
  return {
    sign: pos.sign,
    degrees: pos.degrees,
    minutes: pos.minutes
  };
}

function compactPlanet(planet, mode) {
  if (!planet) return null;
  const selected = mode === 'sidereal' ? planet.sidereal : planet.tropical;
  const pos = compactPosition(selected);
  if (!pos) return null;
  if (planet.retrograde !== undefined) pos.retrograde = Boolean(planet.retrograde);
  return pos;
}

function buildFollowUpAstrologyContext(astrologyData, tradition) {
  if (!astrologyData || typeof astrologyData !== 'object') {
    return { tradition: tradition || 'western', available: false };
  }

  const mode = tradition === 'vedic' ? 'sidereal' : 'tropical';
  const planets = astrologyData.planets || {};
  const context = {
    tradition: tradition || (astrologyData.meta && astrologyData.meta.tradition) || 'western',
    available: true,
    birthContext: astrologyData.meta ? {
      dob: astrologyData.meta.dob,
      birthTime: astrologyData.meta.birthTime,
      hadBirthTime: astrologyData.meta.hadTime,
      birthplace: astrologyData.meta.birthplace,
      timezone: astrologyData.meta.timezone,
      coordinatesResolved: astrologyData.meta.resolved
    } : null,
    angles: {
      ascendant: compactPosition(astrologyData.ascendant && astrologyData.ascendant[mode]),
      midheaven: compactPosition(astrologyData.midheaven && astrologyData.midheaven[mode])
    },
    luminaries: {
      sun: compactPlanet(planets.Sun || (astrologyData.signs && astrologyData.signs.sun), mode),
      moon: compactPlanet(planets.Moon || (astrologyData.signs && astrologyData.signs.moon), mode)
    },
    planets: {},
    houses: astrologyData.houses && Array.isArray(astrologyData.houses.cusps) ? {
      system: astrologyData.houses.system,
      cusps: astrologyData.houses.cusps.slice(0, 12).map(compactPosition)
    } : null
  };

  const planetNames = tradition === 'vedic'
    ? ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu']
    : ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
  for (const name of planetNames) {
    const pos = compactPlanet(planets[name], mode);
    if (pos) context.planets[name] = pos;
  }

  if (tradition === 'vedic' && astrologyData.vedic) {
    const md = astrologyData.vedic.dasha && astrologyData.vedic.dasha.mahaDasha;
    context.vedic = {
      rashi: compactPosition(astrologyData.vedic.rashi),
      lagna: compactPosition(astrologyData.vedic.lagna),
      nakshatra: astrologyData.vedic.nakshatra ? {
        name: astrologyData.vedic.nakshatra.name,
        number: astrologyData.vedic.nakshatra.number,
        pada: astrologyData.vedic.nakshatra.pada,
        degrees: astrologyData.vedic.nakshatra.degr,
        minutes: astrologyData.vedic.nakshatra.minutes
      } : null,
      dasha: md ? {
        mahaDasha: {
          lord: md.lord,
          balanceYears: md.balanceYears,
          balanceMonths: md.balanceMonths,
          balanceDays: md.balanceDays
        },
        antardashas: Array.isArray(astrologyData.vedic.dasha.antardashas)
          ? astrologyData.vedic.dasha.antardashas.slice(0, 5).map(function (ad) {
              return { lord: ad.lord, years: ad.years };
            })
          : []
      } : null
    };
  }

  if (tradition === 'hellenic' && astrologyData.hellenistic) {
    const lots = astrologyData.hellenistic.lots || {};
    context.hellenistic = {
      sect: astrologyData.hellenistic.sect,
      lots: {
        fortune: compactPosition(lots.fortune),
        spirit: compactPosition(lots.spirit),
        eros: compactPosition(lots.eros),
        nike: compactPosition(lots.nike)
      },
      dignities: astrologyData.hellenistic.dignities || null
    };
  }

  return context;
}

async function generateAnswer(params) {
  const question = params.question || '';
  if (!question) {
    return { answer: 'Please ask a question.' };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { answer: 'AI answer generation is currently unavailable. Please try again later.' };
  }

  try {
    const client = new OpenAI({
      baseURL: getProviderConfig().baseURL,
      apiKey: apiKey
    });

    const astrologyContext = params.astrologyData || {};
    const tradition = params.tradition || 'western';
    const intent = params.questionIntent || { topic: 'general', timing: false };
    const followUpAstrologyContext = buildFollowUpAstrologyContext(astrologyContext, tradition);
    const astroSummary = JSON.stringify(followUpAstrologyContext);

    const prompt = 'You are answering the user\'s exact follow-up question about their personalized astrology reading. ' +
      'Answer the question itself first; do not replace the answer with generic life advice, philosophical filler, or unrelated quotes. ' +
      'Tradition: ' + tradition + '. Respect this tradition and do not mix terminology from other traditions. ' +
      'Identified intent: ' + intent.topic + (intent.timing ? ' with timing focus' : '') + '. ' +
      'Supplied compact astrology context only: ' + (astroSummary || 'none calculated') + '. ' +
      'User question: ' + question + '. ' +
      'Use only the supplied astrology context. Never invent astrology facts, dates, planetary placements, houses, Dasha periods, transits, Nakshatra information, or unsupported techniques. ' +
      'For timing questions, provide an approximate period only when supported by actual available timing data; otherwise say the available data cannot derive a reliable timing window and give the strongest supported interpretation. ' +
      'For intimacy questions, keep the answer professional, non-graphic, and focused on romantic readiness and consent. ' +
      'Answer directly first, then briefly explain the astrological basis. Do not make guaranteed predictions. ' +
      'Keep the answer concise (3-4 sentences max). Return HTML with <p class="reading-paragraph"> tags only.';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const completion = await client.chat.completions.create({
      model: getProviderConfig().model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_completion_tokens: 500
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const text = completion.choices[0]?.message?.content || '';
    if (text && text.trim().length > 0) {
      return { answer: text.trim() };
    }

    return { answer: 'I could not generate a specific answer at this moment. Please try asking in a different way.' };
  } catch (err) {
    console.warn('[groqProvider] generateAnswer failed:', err.message);
    return { answer: 'Answer generation encountered an issue. Please try again.' };
  }
}

module.exports.generateAnswer = generateAnswer;

module.exports = {
  name: "groq",
  generateReading,
  generateAnswer
};