/**
 * PalmPyaar Gemini Provider (STUB ONLY)
 * Implements the standard Provider Interface: generateReading({ name, dob, birthplace, tradition, photoHash })
 * Calls to Gemini LLM are NOT implemented yet per Phase 3 specifications.
 * Automatically delegates to templateProvider until AI integration phase is active.
 */

const templateProvider = require('./templateProvider');

async function generateReading(params) {
  // Stub implementation: Fallback to templateProvider until Gemini LLM integration is activated
  return templateProvider.generateReading(params);
}

module.exports = {
  generateReading
};
