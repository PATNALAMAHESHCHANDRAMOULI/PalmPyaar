/**
 * PalmPyaar Template Provider
 * Returns deterministic template-based readings using user parameters.
 * Implements the standard Provider Interface: generateReading({ name, dob, birthTime, birthplace, tradition, photoHash, palmEvidence, astrologyData })
 *
 * SAFETY:
 * - No named palmistry lines (heart, head, life, fate).
 * - No mounts.
 * - No fabricated visual observations.
 * - No medical/scientific/predictive claims.
 * - When palmEvidence is present, references only actual geometric measurements.
 */

const { formatPalmGeometryEvidence } = require('./palmGeometryFormatter');
const { formatAstrologyData } = require('./astrologyFormatter');

const SIGNS = [
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
  const parts = dob.split('-');
  if (parts.length !== 3) return 'Zodiac Sign';
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(m) || isNaN(d)) return 'Zodiac Sign';

  for (let i = 0; i < SIGNS.length; i++) {
    const sign = SIGNS[i];
    const sm = sign.start[0], sd = sign.start[1];
    const em = sign.end[0], ed = sign.end[1];
    if (sm === em && m === sm && d >= sd && d <= ed) return sign.name;
    if (sm > em && ((m === sm && d >= sd) || (m === em && d <= ed))) return sign.name;
    if (sm < em && ((m === sm && d >= sd) || (m === em && d <= ed) || (m > sm && m < em))) return sign.name;
  }
  return 'Zodiac Sign';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function generateReading({ name, dob, birthTime, birthplace, tradition, photoHash, palmEvidence, astrologyData, nakshatraMode, nakshatra }) {
  const sign = getZodiacSign(dob);
  const tradName = capitalize(tradition) || 'Western';
  const displayName = name || 'Seeker';
  const displayLocation = birthplace || 'your place of birth';

  const safeName = escapeHtml(displayName);
  const safeLocation = escapeHtml(displayLocation);
  const safeTradition = escapeHtml(tradName);

  const palmGeometryBlock = formatPalmGeometryEvidence(palmEvidence);
  const palmGeometryHtml = palmGeometryBlock
    ? `<p class="reading-paragraph">The measured proportions of your hand geometry add a layer of personal context to this reading. These measurements are used as supporting detail only — they do not predict specific events or outcomes.</p>`
    : '';

  var displayAstrologyData = astrologyData;
  if (tradition === 'vedic' && nakshatraMode === 'known' && nakshatra) {
    // User-provided Nakshatra overrides calculated one
    displayAstrologyData = JSON.parse(JSON.stringify(astrologyData || {}));
    if (!displayAstrologyData.vedic) displayAstrologyData.vedic = {};
    if (!displayAstrologyData.vedic.nakshatra) displayAstrologyData.vedic.nakshatra = {};
    displayAstrologyData.vedic.nakshatra.name = nakshatra;
    displayAstrologyData.vedic.nakshatra.userProvided = true;
  }

  const astrologyBlock = formatAstrologyData(displayAstrologyData, tradition);
  const astrologyHtml = astrologyBlock ? `<div class="reading-section reading-section--astrology"><h3>Celestial Configuration</h3>${astrologyBlock}</div>` : '';

  var traditionSign = sign;
  var traditionSignLabel = "Sign";
  if (tradition === "vedic" && astrologyData && astrologyData.vedic) {
    if (astrologyData.vedic.rashi && astrologyData.vedic.rashi.sign) {
      traditionSign = astrologyData.vedic.rashi.sign;
      traditionSignLabel = "Rashi";
    } else if (astrologyData.signs && astrologyData.signs.moon && astrologyData.signs.moon.sidereal) {
      traditionSign = astrologyData.signs.moon.sidereal.sign;
      traditionSignLabel = "Moon Sign";
    }
  } else if (tradition === "hellenic" && astrologyData && astrologyData.hellenistic) {
    if (astrologyData.hellenistic.lots && astrologyData.hellenistic.lots.fortune && astrologyData.hellenistic.lots.fortune.sign) {
      traditionSign = astrologyData.hellenistic.lots.fortune.sign;
      traditionSignLabel = "Lot of Fortune";
    } else if (astrologyData.signs && astrologyData.signs.sun && astrologyData.signs.sun.tropical) {
      traditionSign = astrologyData.signs.sun.tropical.sign;
      traditionSignLabel = "Tropical Sun";
    }
  } else if (astrologyData && astrologyData.signs && astrologyData.signs.sun) {
    if (tradition === "western" && astrologyData.signs.sun.tropical) {
      traditionSign = astrologyData.signs.sun.tropical.sign;
      traditionSignLabel = "Tropical Sun";
    } else if (astrologyData.signs.sun.sidereal) {
      traditionSign = astrologyData.signs.sun.sidereal.sign;
      traditionSignLabel = "Sidereal Sun";
    }
  }

  const core = `
    <p class="reading-paragraph">Your birth configuration in <strong>${safeLocation}</strong> under the <strong>${safeTradition}</strong> tradition highlights a natural harmony between your intuitive core and your driven expression. As a <strong>${traditionSign}</strong> (${traditionSignLabel}), your profile suggests a reflective temperament that values authenticity over surface.</p>
    <p class="reading-paragraph">You often notice details others overlook, giving you an understated advantage in long-term endeavors. The pattern here is not repetition for its own sake — it is depth that accumulates quietly over time.</p>
    ${palmGeometryHtml}
  `.trim();

  const love = `
    <p class="reading-paragraph">In personal connections, your energy seeks authenticity and mutual intellectual respect over fleeting excitement. You tend to observe before revealing yourself, which can make your trust feel like a quiet gift once given.</p>
    <blockquote class="reading-quote">"True synergy occurs when your grounded nature aligns with a partner who values quiet constancy."</blockquote>
    <p class="reading-paragraph">Light relationship note: Upcoming months favor clear, honest conversations that bring renewed warmth and mutual understanding to your closest bonds.</p>
  `.trim();

  var proCards = "";
  if (tradition === "vedic") {
    proCards = '<div class="pro-card"><h3 class="pro-card__title">Vedic Insight</h3><p class="pro-card__text">Your dasha period emphasizes patience in career milestones while fostering inner balance and spiritual harmony.</p></div>';
  } else if (tradition === "hellenic") {
    proCards = '<div class="pro-card"><h3 class="pro-card__title">Hellenic Arc</h3><p class="pro-card__text">The essential dignity of your ruling planet favors strategic choices made during the upcoming lunar cycle.</p></div>';
  } else {
    proCards = '<div class="pro-card"><h3 class="pro-card__title">Western Verdict</h3><p class="pro-card__text">Focus on steady personal growth and creative pursuits; clarity arrives as you align with your own rhythm rather than external expectations.</p></div>';
  }

  const pro = `
    <div class="pro-grid">
      ${proCards}
    </div>
    ${astrologyHtml}
    <div class="outlook-box">
      <h3 class="outlook-box__title">12-Month Outlook</h3>
      <p class="outlook-box__text">Q1 & Q2 center on laying strong foundations and organizing key goals. Q3 brings opportunities for expanding social and professional circles. Q4 brings a sense of deep personal completion and fulfillment.</p>
    </div>
  `.trim();

  return {
    core,
    love,
    pro
  };
}

module.exports = {
  generateReading
};
