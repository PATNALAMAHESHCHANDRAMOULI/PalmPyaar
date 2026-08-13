/**
 * PalmPyaar Palm Geometry Formatter
 *
 * Converts validated sanitized palmEvidence into a safe, structured prompt block.
 *
 * SECURITY:
 * - Input MUST already pass strict server-side whitelist validation (isValidPalmEvidence).
 * - This formatter does NOT validate — it assumes clean numeric input.
 * - Never accepts raw images, base64, strings, arrays, or unknown keys.
 *
 * WHAT THIS FORMATTER DOES:
 * - Emits actual numeric measurements.
 * - Adds interpretation rules that forbid named palmistry claims.
 * - Keeps the block compact and useful for the AI writer/reviewer/rewriter.
 *
 * WHAT THIS FORMATTER NEVER DOES:
 * - Invent named palm lines (heart, head, life, fate).
 * - Invent mounts.
 * - Claim medical, scientific, or predictive validity.
 * - Accept arbitrary user input inside the evidence block.
 *
 * @module providers/palmGeometryFormatter
 */

/**
 * Format sanitized palmEvidence into a prompt-ready string block.
 *
 * @param {Object|null} palmEvidence - Validated geometric evidence from extractGeometry()
 * @returns {string} Formatted prompt section or empty string if no evidence
 */
function formatPalmGeometryEvidence(palmEvidence) {
  if (!palmEvidence || typeof palmEvidence !== 'object') {
    return '';
  }

  const lines = [
    'PALM GEOMETRY EVIDENCE',
    'Palm geometry was extracted locally from the uploaded hand image using 21 MediaPipe hand landmarks.',
    '',
    'Measurements:'
  ];

  if (palmEvidence.palmBounds && typeof palmEvidence.palmBounds === 'object') {
    const pb = palmEvidence.palmBounds;
    lines.push(`- Palm aspect ratio (width / height): ${pb.aspectRatio}`);
    lines.push(`- Palm normalized width: ${pb.width}`);
    lines.push(`- Palm normalized height: ${pb.height}`);
  }

  if (palmEvidence.fingerRatios && typeof palmEvidence.fingerRatios === 'object') {
    const fr = palmEvidence.fingerRatios;
    lines.push(`- Finger extension ratio — index: ${fr.index}`);
    lines.push(`- Finger extension ratio — middle: ${fr.middle}`);
    lines.push(`- Finger extension ratio — ring: ${fr.ring}`);
    lines.push(`- Finger extension ratio — pinky: ${fr.pinky}`);
    lines.push(`- Finger extension ratio — thumb: ${fr.thumb}`);
  }

  if (palmEvidence.geometricRatios && typeof palmEvidence.geometricRatios === 'object') {
    const gr = palmEvidence.geometricRatios;
    lines.push(`- Index-to-middle finger length ratio: ${gr.indexToMiddle}`);
    lines.push(`- Finger span (index MCP to pinky MCP) to palm height ratio: ${gr.fingerSpanToHeight}`);
    lines.push(`- Thumb-to-index distance ratio (relative to wrist): ${gr.thumbToIndex}`);
  }

  if (typeof palmEvidence.palmAngle === 'number') {
    lines.push(`- Palm orientation angle (wrist to middle finger MCP): ${palmEvidence.palmAngle} degrees`);
  }

  lines.push('');
  lines.push('Interpretation rules:');
  lines.push('- These are geometric measurements only — not traditional palmistry readings.');
  lines.push('- Do not rename these measurements as heart line, head line, life line, fate line, or any other named palmistry feature.');
  lines.push('- Do not infer mounts, branches, forks, islands, or markings.');
  lines.push('- Do not infer personality traits, medical conditions, or scientific facts from these numbers.');
  lines.push('- Do not predict future events based on these measurements.');
  lines.push('- Use the measurements as supporting context for tone and personalization, not as proof of specific outcomes.');
  lines.push('- If a measurement is missing or zero, do not invent a value or claim it indicates a specific trait.');

  return lines.join('\n');
}

module.exports = {
  formatPalmGeometryEvidence
};
