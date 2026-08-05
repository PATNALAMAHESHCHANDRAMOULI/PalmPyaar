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
  // Read API key from environment
  const apiKey = process.env.GEMINI_API_KEY;

  // If no API key, immediately fallback to template provider
  if (!apiKey) {
    return templateProvider.generateReading(params);
  }

  try {
    // Initialize Google Generative AI client
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // Build prompt using the prompt builder
    const prompt = buildReadingPrompt(params);

    // Send request to Gemini with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048,
      }
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    // Extract plain text response
    const response = result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from Gemini');
    }

    // Parse response into structured sections
    const parsed = parseGeminiResponse(text);

    // Ensure all sections have content (fallback to template for missing sections)
    const templateReading = await templateProvider.generateReading(params);

    return {
      core: parsed.core || templateReading.core,
      love: parsed.love || templateReading.love,
      pro: parsed.pro || templateReading.pro
    };

  } catch (err) {
    // On ANY error (API error, timeout, invalid response, missing key, etc.),
    // immediately fallback to template provider
    // Never throw an uncaught error, never break the reading flow
    return templateProvider.generateReading(params);
  }
}

module.exports = {
  name: "gemini",
  generateReading
};
