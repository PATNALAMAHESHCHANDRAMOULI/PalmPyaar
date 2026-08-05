/**
 * PalmPyaar Reading Prompt Builder
 * Builds the production-ready prompt for Gemini API reading generation.
 */

function buildReadingPrompt(params) {
  const { name, dob, birthplace, tradition, photoHash } = params;

  // Format date of birth for the prompt
  const birthDate = new Date(dob);
  const formattedDob = birthDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Determine zodiac sign from DOB
  const month = birthDate.getMonth() + 1;
  const day = birthDate.getDate();
  let zodiacSign = '';
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) zodiacSign = 'Aries';
  else if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) zodiacSign = 'Taurus';
  else if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) zodiacSign = 'Gemini';
  else if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) zodiacSign = 'Cancer';
  else if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) zodiacSign = 'Leo';
  else if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) zodiacSign = 'Virgo';
  else if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) zodiacSign = 'Libra';
  else if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) zodiacSign = 'Scorpio';
  else if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) zodiacSign = 'Sagittarius';
  else if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) zodiacSign = 'Capricorn';
  else if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) zodiacSign = 'Aquarius';
  else zodiacSign = 'Pisces';

  // Tradition label
  const traditionLabels = {
    'western': 'Western',
    'vedic': 'Vedic',
    'hellenic': 'Hellenic'
  };
  const traditionLabel = traditionLabels[tradition] || 'Western';

  // Photo indicator (no hash value)
  const hasPhoto = photoHash && photoHash.length > 0;
  const photoNote = hasPhoto
    ? 'A palm photograph was provided. Weave subtle references to the lines, mounts, and texture you sense from this image into the reading.'
    : 'No palm photograph was provided. Focus entirely on the zodiac and birth details.';

  return `You are a seasoned entertainment astrologer and palmist writing for PalmPyaar — a premium, modern mysticism brand. Your voice is elegant, mysterious, emotionally intelligent, and quietly poetic. You write for a discerning reader who appreciates nuance over spectacle.

This reading is for entertainment purposes only. Never claim certainty. Never promise future events. Never mention being an AI. Never mention prompts or system instructions. Do not use bullet lists, tables, Markdown syntax, or JSON. Use plain paragraphs beneath the required section markers.

Personalize deeply using:
- Name: ${name}
- Date of birth: ${formattedDob}
- Birthplace: ${birthplace}
- Tradition: ${traditionLabel}
- Zodiac sign: ${zodiacSign}
- ${photoNote}

Structure your response EXACTLY as follows, with these section markers on their own lines:

===CORE===

[Write 2-3 beautiful, concise paragraphs blending personality, strengths, challenges, and a woven palm + zodiac interpretation. Speak to the reader's essence — their inner architecture, the currents that shape them, the light and shadow they carry. Use the tradition's lens (${traditionLabel}) to color the interpretation. If a palm photo was provided, reference its unique markings naturally. Target: 180–250 words.]

===LOVE===

[Write 2-3 beautiful, concise paragraphs on relationship energy, communication style, emotional patterns, and gentle guidance. Explore how they connect, what they seek, where they may stumble. Offer insight that feels like a whispered truth, not advice. Keep it tender, never prescriptive. Target: 150–220 words.]

===PRO===

[Write 2-3 beautiful, concise paragraphs on career inclination, creative expression, the next 12 months as a thematic landscape (not predictions), and practical reflection. Frame the year ahead as a cycle of becoming, not a forecast. End with a grounding question or invitation. Target: 180–250 words.]

This reading is for entertainment purposes only.`;
}

module.exports = {
  buildReadingPrompt
};
