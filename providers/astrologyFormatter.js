/**
 * PalmPyaar Astrology Formatter
 *
 * Converts validated astrologyData into a safe, structured HTML block
 * for display in readings.
 *
 * SECURITY:
 * - Input astrologyData is computed server-side via calculateChart().
 * - Never renders raw coordinates or internal calculation variables.
 * - Only displays sign names, degrees, and tradition-appropriate insights.
 * - Does not make predictive claims.
 */

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer',
  'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

/**
 * Format a sign + degree + minute as a display string.
 * @param {object} pos - {sign, degrees, minutes}
 * @returns {string}
 */
function formatPosition(pos) {
  if (!pos || !pos.sign || pos.degrees === undefined) return 'unspecified';
  return pos.sign + ' ' + pos.degrees + '\u00b0' + (pos.minutes || 0) + "'";
}

/**
 * Format astrologyData into a concise text summary for the AI prompt.
 * This is NOT displayed to the user — it is internal context only.
 * @param {object|null} astrologyData
 * @returns {string} text summary or empty string
 */
function formatAstrologySummary(astrologyData) {
  if (!astrologyData || typeof astrologyData !== 'object') return '';

  var parts = [];

  var asc = astrologyData.ascendant;
  if (asc && asc.sidereal && asc.sidereal.sign) {
    parts.push('Lagna (Rising, sidereal): ' + asc.sidereal.sign + ' ' + asc.sidereal.degrees + '\u00b0' + asc.sidereal.minutes + "'");
  }

  var signs = astrologyData.signs;
  if (signs) {
    if (signs.sun && signs.sun.sidereal) {
      parts.push('Sun (sidereal): ' + signs.sun.sidereal.sign + ' ' + signs.sun.sidereal.degrees + '\u00b0');
    }
    if (signs.moon && signs.moon.sidereal) {
      parts.push('Moon (sidereal): ' + signs.moon.sidereal.sign + ' ' + signs.moon.sidereal.degrees + '\u00b0');
    }
  }

  var vedic = astrologyData.vedic;
  if (vedic && vedic.nakshatra && vedic.nakshatra.name) {
    parts.push('Nakshatra: ' + vedic.nakshatra.name + ' (Pada ' + (vedic.nakshatra.pada || '?') + ')');
  }
  if (vedic && vedic.dasha && vedic.dasha.mahaDasha) {
    parts.push('Dasha lord: ' + vedic.dasha.mahaDasha.lord + ' (' + (vedic.dasha.mahaDasha.balanceYears || 0) + ' yrs)');
  }

  var hellenistic = astrologyData.hellenistic;
  if (hellenistic && hellenistic.lots && hellenistic.lots.fortune) {
    parts.push('Lot of Fortune: ' + hellenistic.lots.fortune.sign + ' ' + hellenistic.lots.fortune.degrees + '\u00b0');
  }

  return parts.length > 0 ? 'Astrology: ' + parts.join(' | ') : '';
}

/**
 * Format astrologyData into an HTML block appropriate for the given tradition.
 * @param {object|null} astrologyData - Output of calculateChart()
 * @param {string} tradition - 'western', 'vedic', or 'hellenic'
 * @returns {string} HTML string or empty string
 */
function formatAstrologyData(astrologyData, tradition) {
  if (!astrologyData || typeof astrologyData !== 'object') return '';

  const meta = astrologyData.meta || {};
  const signs = astrologyData.signs || {};
  const asc = astrologyData.ascendant || {};
  const mc = astrologyData.midheaven || {};
  const planets = astrologyData.planets || {};
  const vedic = astrologyData.vedic || {};
  const hellenistic = astrologyData.hellenistic || {};

  var lines = [];

  lines.push('<div class="astrology-block">');
  lines.push('<p class="reading-paragraph">Your cosmic blueprint — derived from your birth date, time, and location:</p>');

  // Ascendant (Lagna)
  const ascSign = (asc.sidereal && asc.sidereal.sign) || (asc.tropical && asc.tropical.sign);
  if (ascSign) {
    lines.push('<p class="reading-paragraph"><strong>Lagna (Rising)</strong>: ' + (asc.sidereal ? formatPosition(asc.sidereal) : formatPosition(asc.tropical)) + '</p>');
  }

  // Sun & Moon
  if (signs.sun) {
    lines.push('<p class="reading-paragraph"><strong>Surya (Sun)</strong>: ' + formatPosition(signs.sun.tropical) + ' (tropical), ' + formatPosition(signs.sun.sidereal) + ' (sidereal)</p>');
  }
  if (signs.moon) {
    lines.push('<p class="reading-paragraph"><strong>Chandra (Moon)</strong>: ' + formatPosition(signs.moon.tropical) + ' (tropical), ' + formatPosition(signs.moon.sidereal) + ' (sidereal)</p>');
  }

  // Midheaven
  if (mc.sidereal && mc.sidereal.sign) {
    lines.push('<p class="reading-paragraph"><strong>MC (Midheaven)</strong>: ' + formatPosition(mc.sidereal) + ' (sidereal)</p>');
  }

  // Vedic-specific
  if (tradition === 'vedic') {
    if (vedic.nakshatra && vedic.nakshatra.name) {
      lines.push('<p class="reading-paragraph"><strong>Nakshatra</strong>: ' + vedic.nakshatra.name + ' (Pada ' + (vedic.nakshatra.pada || '?') + ', degrees ' + vedic.nakshatra.degr + '"</p>');
    }
    if (vedic.dasha && vedic.dasha.mahaDasha) {
      const md = vedic.dasha.mahaDasha;
      lines.push('<p class="reading-paragraph"><strong>Antar Dasha</strong>: ' + md.lord + ' (' + (md.balanceYears || 0) + ' yrs balance)</p>');
    }
    if (vedic.rashi && vedic.rashi.sign) {
      lines.push('<p class="reading-paragraph"><strong>Rashi (Moon sign)</strong>: ' + formatPosition(vedic.rashi) + '</p>');
    }
  }

  // Hellenistic-specific
  if (tradition === 'hellenic') {
    if (hellenistic.lots && hellenistic.lots.fortune) {
      lines.push('<p class="reading-paragraph"><strong>Lot of Fortune</strong>: ' + formatPosition(hellenistic.lots.fortune) + '</p>');
    }
    if (hellenistic.lots && hellenistic.lots.spirit) {
      lines.push('<p class="reading-paragraph"><strong>Lots of Spirit</strong>: ' + formatPosition(hellenistic.lots.spirit) + '</p>');
    }
    if (hellenistic.sect) {
      lines.push('<p class="reading-paragraph"><strong>Sect</strong>: ' + hellenistic.sect + '-born chart</p>');
    }
  }

  // Planetary positions (summary)
  const visiblePlanets = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];
  var planetSummary = [];
  for (const pname of visiblePlanets) {
    if (planets[pname] && planets[pname].sidereal && planets[pname].sidereal.sign) {
      planetSummary.push(pname + ': ' + planets[pname].sidereal.sign + ' ' + planets[pname].sidereal.degrees + '\u00b0');
    }
  }
  if (planetSummary.length > 0) {
    lines.push('<p class="reading-paragraph"><strong>Planetary positions (sidereal)</strong>: ' + planetSummary.join(' \u00b7 ') + '</p>');
  }

  if (meta.resolved) {
    lines.push('<p class="reading-paragraph">Coordinates resolved for ' + meta.birthplace + ' (' + meta.coordinates.lat.toFixed(2) + '\u00b0, ' + meta.coordinates.lng.toFixed(2) + '\u00b0). Time zone: ' + meta.timezone + '.</p>');
  } else {
    lines.push('<p class="reading-paragraph">Birthplace coordinates could not be resolved; chart computed with reference position. Results may vary.</p>');
  }

  lines.push('</div>');

  return lines.join('\n');
}

module.exports = {
  formatAstrologyData,
  formatAstrologySummary,
  formatPosition
};
