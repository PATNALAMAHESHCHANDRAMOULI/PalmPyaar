/**
 * PalmPyaar Gemini Provider
 * Implements the standard Provider Interface: generateReading({ name, dob, birthplace, tradition, photoHash })
 * Live Gemini API integration using Google Generative AI JavaScript SDK.
 */

const templateProvider = require('./templateProvider');
const { buildReadingPrompt } = require('../prompts/readingPrompt');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Parses Gemini's plain text response using ONLY the required section markers:
 * ===CORE===, ===LOVE===, ===PRO===
 * No regex guessing or paragraph heuristics.
 * Returns empty strings for missing sections.
 */
function parseGeminiResponse(text) {
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

async function generateReading(params) {
  console.log('[geminiProvider] generateReading called with params:', JSON.stringify(params));
  // Read API key from environment
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('[geminiProvider] GEMINI_API_KEY present:', !!apiKey);

  // If no API key, immediately fallback to template provider
  if (!apiKey) {
    console.log('[geminiProvider] No API key, falling back to templateProvider');
    return templateProvider.generateReading(params);
  }

  // Initialize Google Generative AI client
  const genAI = new GoogleGenerativeAI(apiKey);

  // Build prompt using the prompt builder
  const prompt = buildReadingPrompt(params);
  console.log('[geminiProvider] Prompt built, length:', prompt.length);

  // Use single production model
  console.log('[geminiProvider] Using model: gemini-2.0-flash');
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash'
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048,
      }
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const response = result.response;
    const text = response.text();
    console.log('[geminiProvider] Raw Gemini response length:', text ? text.length : 0);
    console.log('[geminiProvider] Raw Gemini response preview:', text ? text.slice(0, 500) : 'EMPTY');

    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from Gemini');
    }

    // Parse response into structured sections
    const parsed = parseGeminiResponse(text);
    console.log('[geminiProvider] Parsed sections:', {
      coreLength: parsed.core.length,
      loveLength: parsed.love.length,
      proLength: parsed.pro.length,
      corePreview: parsed.core.slice(0, 100),
      lovePreview: parsed.love.slice(0, 100),
      proPreview: parsed.pro.slice(0, 100)
    });

    // Ensure all sections have content (fallback to template for missing sections)
    const templateReading = await templateProvider.generateReading(params);
    console.log('[geminiProvider] Template reading fetched for fallback');

    const finalResult = {
      core: parsed.core || templateReading.core,
      love: parsed.love || templateReading.love,
      pro: parsed.pro || templateReading.pro
    };
    console.log('[geminiProvider] Final result - using template for:', {
      core: !parsed.core,
      love: !parsed.love,
      pro: !parsed.pro
    });
    console.log('[geminiProvider] Gemini generation successful.');
    return finalResult;

  } catch (err) {
    clearTimeout(timeoutId);

    console.error('[geminiProvider] Gemini generation failed:');
    console.error(err);
    console.warn('[geminiProvider] Falling back to template provider.');

    return templateProvider.generateReading(params);
  }
}

module.exports = {
  name: "gemini",
  generateReading
};
