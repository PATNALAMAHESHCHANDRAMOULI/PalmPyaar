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
      model: 'llama-3.3-70b-versatile',
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
      model: 'llama-3.3-70b-versatile',
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

  // If no API key, immediately fallback to template provider
  if (!apiKey) {
    console.log('[groqProvider] No API key, falling back to templateProvider');
    return templateProvider.generateReading(params);
  }

  // Initialize OpenAI client configured for Groq
  const client = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
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
  
  // If pipeline not ready, fallback to template
  if (pipeline.status !== 'ready') {
    console.warn('[groqProvider] Pipeline not ready, falling back to templateProvider');
    return templateProvider.generateReading(params);
  }

  // Use single production model
  console.log('[groqProvider] Using model: llama-3.3-70b-versatile');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
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
      birthplace: params.birthplace,
      tradition: params.tradition,
      photoHashPresent: !!params.photoHash
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

    // Return internally: { draft, review, rewritten }
    // Public API still returns: final reading only
    // Review/rewrite are only logged
    return finalReading;

  } catch (err) {
    clearTimeout(timeoutId);

    console.error('[groqProvider] Groq generation failed:');
    console.error(err);
    console.warn('[groqProvider] Falling back to template provider.');

    return templateProvider.generateReading(params);
  }
}

module.exports = {
  name: "groq",
  generateReading
};