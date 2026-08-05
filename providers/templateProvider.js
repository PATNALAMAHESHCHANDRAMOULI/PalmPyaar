/**
 * PalmPyaar Template Provider
 * Returns deterministic template-based readings using user parameters.
 * Implements the standard Provider Interface: generateReading({ name, dob, birthplace, tradition, photoHash, tier })
 */

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

async function generateReading({ name, dob, birthplace, tradition, photoHash, tier }) {
  const sign = getZodiacSign(dob);
  const tradName = capitalize(tradition) || 'Western';
  const displayName = name || 'Seeker';
  const displayLocation = birthplace || 'your place of birth';
  const hasPhoto = photoHash && photoHash.length > 0;

  const safeName = escapeHtml(displayName);
  const safeLocation = escapeHtml(displayLocation);
  const safeTradition = escapeHtml(tradName);

  const photoNote = hasPhoto
    ? ' Your locally hashed palm image aligns with a rare double-loop heart line pattern.'
    : '';

  const core = `
    <p class="reading-paragraph">Your birth configuration in <strong>${safeLocation}</strong> under the <strong>${safeTradition}</strong> tradition highlights a natural harmony between your intuitive core and your driven expression. As a <strong>${sign}</strong>, your palm signature indicates high resilience and reflective depth.${photoNote}</p>
    <p class="reading-paragraph">The subtle curves of your headline suggest a mind that processes experiences thoroughly before taking decisive action. You often notice details others overlook, giving you an understated advantage in long-term endeavors.</p>
  `.trim();

  const love = `
    <p class="reading-paragraph">In personal connections, your energy seeks authenticity and mutual intellectual respect over fleeting excitement. Your palm’s heart line trajectory shows a deep capacity for empathy paired with clear personal boundaries.</p>
    <blockquote class="reading-quote">"True synergy occurs when your grounded nature aligns with a partner who values quiet constancy."</blockquote>
    <p class="reading-paragraph">Light relationship note: Upcoming months favor clear, honest conversations that bring renewed warmth and mutual understanding to your closest bonds.</p>
  `.trim();

  const pro = `
    <div class="pro-grid">
      <div class="pro-card">
        <h3 class="pro-card__title">Western Verdict</h3>
        <p class="pro-card__text">Focus on steady personal growth and creative pursuits; clarity arrives as Saturn aligns with your focal solar house.</p>
      </div>
      <div class="pro-card">
        <h3 class="pro-card__title">Vedic Insight</h3>
        <p class="pro-card__text">Your dasha period emphasizes patience in career milestones while fostering inner balance and spiritual harmony.</p>
      </div>
      <div class="pro-card">
        <h3 class="pro-card__title">Hellenic Arc</h3>
        <p class="pro-card__text">The essential dignity of your ruling planet favors strategic choices made during the upcoming lunar cycle.</p>
      </div>
    </div>
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
