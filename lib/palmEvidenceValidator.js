/**
 * Server-side validation for palmEvidence objects received from the browser.
 *
 * The browser-side extractor (js/palmValidator.js) produces a strictly-shaped
 * geometric evidence object. This module mirrors that shape validation so the
 * server can reject tampered, injected, or prototype-polluted evidence before
 * it is bound into signed tokens or forwarded to the AI provider.
 *
 * Evidence shape (all numbers, all finite):
 *   {
 *     palmBounds:       { width, height, aspectRatio },   // [0, 2]
 *     fingerRatios:     { index, middle, ring, pinky, thumb }, // [0, 2]
 *     geometricRatios:  { indexToMiddle, fingerSpanToHeight, thumbToIndex }, // [0, 5]
 *     palmAngle:        number  // [-180, 180]
 *   }
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRange(v, min, max) {
  return isFiniteNumber(v) && v >= min && v <= max;
}

function validateNumberObject(obj, keys, min, max) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  var actualKeys = Object.keys(obj);
  if (actualKeys.length !== keys.length) return false;
  for (var i = 0; i < keys.length; i++) {
    if (actualKeys.indexOf(keys[i]) === -1) return false;
    if (!inRange(obj[keys[i]], min, max)) return false;
  }
  return true;
}

/**
 * Validates that a palmEvidence object has the exact expected shape
 * and contains only finite numbers within plausible ranges.
 *
 * @param {*} evidence - The evidence object to validate
 * @returns {boolean} True only if the evidence passes strict whitelist validation
 */
function isValidPalmEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;

  var validTopKeys = ['palmBounds', 'fingerRatios', 'geometricRatios', 'palmAngle'];
  var topKeys = Object.keys(evidence);
  if (topKeys.length !== validTopKeys.length) return false;
  for (var i = 0; i < validTopKeys.length; i++) {
    if (topKeys.indexOf(validTopKeys[i]) === -1) return false;
  }

  if (!validateNumberObject(evidence.palmBounds, ['width', 'height', 'aspectRatio'], 0, 2)) return false;
  if (!validateNumberObject(evidence.fingerRatios, ['index', 'middle', 'ring', 'pinky', 'thumb'], 0, 2)) return false;
  if (!validateNumberObject(evidence.geometricRatios, ['indexToMiddle', 'fingerSpanToHeight', 'thumbToIndex'], 0, 5)) return false;
  if (!inRange(evidence.palmAngle, -180, 180)) return false;

  return true;
}

module.exports = { isValidPalmEvidence };
