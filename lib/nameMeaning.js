/**
 * PalmPyaar Name-Meaning Module
 *
 * Provides a curated, honest answer to "what does my name mean?" follow-up
 * questions. Well-known names are resolved from a hand-maintained lexicon of
 * attested meanings. Names outside the lexicon are NOT invented: we say so
 * plainly and fall back to the Pythagorean name number, which we describe
 * truthfully as an internal letter-value calculation, not a traditional
 * etymology.
 */

'use strict';

const NAME_LEXICON = {
  mahesh: { name: 'Mahesh', meaning: 'Great lord', origin: 'Sanskrit', association: 'An epithet of Lord Shiva', themes: 'greatness, strength, and mastery' },
  mohit: { name: 'Mohit', meaning: 'Attracted, infatuated, one who is charmed', origin: 'Sanskrit', association: 'A classical name evoking love and fascination', themes: 'charm, attraction, and warmth' },
  arjun: { name: 'Arjun', meaning: 'Bright, white, clear; the legendary Pandava warrior', origin: 'Sanskrit', association: 'The celebrated archer hero of the Mahabharata', themes: 'focus, courage, and skill' },
  aarav: { name: 'Aarav', meaning: 'Peaceful, melodious', origin: 'Sanskrit', association: 'A modern name meaning calm and harmony', themes: 'peace, melody, and serenity' },
  aditya: { name: 'Aditya', meaning: 'Son of Aditi; belonging to the sun', origin: 'Sanskrit', association: 'The sun god of the Vedic pantheon', themes: 'radiance, vitality, and dignity' },
  aryan: { name: 'Aryan', meaning: 'Noble, honorable', origin: 'Sanskrit', association: 'A classical term for the noble', themes: 'nobility, honor, and leadership' },
  rahul: { name: 'Rahul', meaning: 'One who conquers all obstacles; also the son of the Buddha', origin: 'Sanskrit', association: 'Prince Siddhartha\'s son, later a monastic disciple', themes: 'conquest, insight, and perseverance' },
  rohit: { name: 'Rohit', meaning: 'Red; the first rays of the sun', origin: 'Sanskrit', association: 'A rising of the sun, red like dawn', themes: 'dawn, warmth, and beginnings' },
  amit: { name: 'Amit', meaning: 'Limitless, infinite', origin: 'Sanskrit', association: 'A name evoking boundlessness', themes: 'expansion, depth, and potential' },
  ankit: { name: 'Ankit', meaning: 'Marked, engraved, distinguished', origin: 'Sanskrit', association: 'One who is stamped with distinction', themes: 'distinction, recognition, and talent' },
  ravi: { name: 'Ravi', meaning: 'The sun', origin: 'Sanskrit', association: 'A classical name for the sun god', themes: 'energy, brilliance, and authority' },
  vikram: { name: 'Vikram', meaning: 'Valour, courage, steady stride', origin: 'Sanskrit', association: 'The great king Vikramaditya', themes: 'courage, strategy, and resolve' },
  vivek: { name: 'Vivek', meaning: 'Discrimination, wisdom, discernment', origin: 'Sanskrit', association: 'The faculty of clear judgment', themes: 'wisdom, discernment, and clarity' },
  priya: { name: 'Priya', meaning: 'Beloved, dear, loved one', origin: 'Sanskrit', association: 'A classical epithet of the beloved', themes: 'affection, sweetness, and devotion' },
  priyanka: { name: 'Priyanka', meaning: 'Beloved; also a sweet herb', origin: 'Sanskrit', association: 'A term of endearment for one who is dear', themes: 'love, charm, and grace' },
  divya: { name: 'Divya', meaning: 'Divine, heavenly, luminous', origin: 'Sanskrit', association: 'That which is radiant and celestial', themes: 'light, grace, and spiritual beauty' },
  shreya: { name: 'Shreya', meaning: 'Auspicious, fortunate, prosperity', origin: 'Sanskrit', association: 'Derived from Shri, goddess of fortune', themes: 'fortune, grace, and prosperity' },
  ananya: { name: 'Ananya', meaning: 'Incomparable, unique, without a second', origin: 'Sanskrit', association: 'That which has no equal', themes: 'uniqueness, devotion, and singularity' },
  anika: { name: 'Anika', meaning: 'Graceful, brilliant, goddess Durga', origin: 'Sanskrit', association: 'A name of the divine feminine', themes: 'grace, brilliance, and strength' },
  isha: { name: 'Isha', meaning: 'Goddess, desire, the ruler; also a form of Parvati', origin: 'Sanskrit', association: 'The divine feminine principle', themes: 'power, desire, and spiritual energy' },
  kriti: { name: 'Kriti', meaning: 'Creation, a work of art', origin: 'Sanskrit', association: 'A name celebrating craft and creativity', themes: 'creation, artistry, and accomplishment' },
  sneha: { name: 'Sneha', meaning: 'Affection, love, tenderness', origin: 'Sanskrit', association: 'A classical word for deep fondness', themes: 'tenderness, bonding, and care' },
  ritika: { name: 'Ritika', meaning: 'One who flows; a stream; also a traditional dance form', origin: 'Sanskrit', association: 'A name of movement and rhythm', themes: 'flow, rhythm, and elegance' },
  sanya: { name: 'Sanya', meaning: 'Radiant, brilliant, excellent', origin: 'Sanskrit', association: 'A classical name of brilliance', themes: 'radiance, excellence, and sparkle' },
  tanvi: { name: 'Tanvi', meaning: 'Slender, delicate, a young goddess', origin: 'Sanskrit', association: 'A name of feminine grace', themes: 'delicacy, elegance, and beauty' },
  aisha: { name: 'Aisha', meaning: 'Alive, living, prosperous', origin: 'Arabic', association: 'A beloved classical Arabic name', themes: 'life, vitality, and prosperity' },
  fatima: { name: 'Fatima', meaning: 'One who abstains; daughter of the Prophet', origin: 'Arabic', association: 'A deeply revered classical name', themes: 'purity, devotion, and honor' },
  mohammed: { name: 'Mohammed', meaning: 'Praised, praiseworthy', origin: 'Arabic', association: 'The name of the Prophet of Islam', themes: 'praise, honor, and devotion' },
  omar: { name: 'Omar', meaning: 'Flourishing, long-lived', origin: 'Arabic', association: 'A classical Arabic name of strength', themes: 'strength, longevity, and flourishing' },
  john: { name: 'John', meaning: 'God is gracious', origin: 'Hebrew', association: 'A biblical name of grace', themes: 'grace, favor, and faithfulness' },
  mary: { name: 'Mary', meaning: 'Beloved; bitter (sea); star of the sea', origin: 'Hebrew', association: 'A biblical name of the mother of Jesus', themes: 'devotion, love, and resilience' },
  david: { name: 'David', meaning: 'Beloved', origin: 'Hebrew', association: 'The biblical king of Israel', themes: 'beloved, courage, and leadership' },
  sarah: { name: 'Sarah', meaning: 'Princess', origin: 'Hebrew', association: 'The biblical matriarch', themes: 'grace, dignity, and leadership' },
  james: { name: 'James', meaning: 'Supplanter (Hebrew Yaakov); one who follows', origin: 'Hebrew', association: 'A classic biblical and royal name', themes: 'steadfastness, trust, and inheritance' },
  elizabeth: { name: 'Elizabeth', meaning: 'God is my oath', origin: 'Hebrew', association: 'A classical biblical and royal name', themes: 'devotion, promise, and nobility' },
  william: { name: 'William', meaning: 'Resolute protector', origin: 'Germanic', association: 'A classic name of strength and protection', themes: 'protection, resolve, and loyalty' },
  george: { name: 'George', meaning: 'Farmer, earth-worker', origin: 'Greek', association: 'A classical Greek name of the earth', themes: 'groundedness, labor, and reliability' },
  alexander: { name: 'Alexander', meaning: 'Defender of men', origin: 'Greek', association: 'The celebrated classical conqueror', themes: 'defense, courage, and leadership' },
  helen: { name: 'Helen', meaning: 'Torch, bright, shining', origin: 'Greek', association: 'A classical name of light', themes: 'light, beauty, and brilliance' },
  sophia: { name: 'Sophia', meaning: 'Wisdom', origin: 'Greek', association: 'The classical personification of wisdom', themes: 'wisdom, insight, and grace' },
  emma: { name: 'Emma', meaning: 'Whole, universal', origin: 'Germanic', association: 'A classical name of completeness', themes: 'wholeness, strength, and care' },
  olivia: { name: 'Olivia', meaning: 'Olive tree; peace', origin: 'Latin', association: 'A name of peace and fruitfulness', themes: 'peace, growth, and abundance' },
  aryan_pal: { name: 'Aryan Pal', meaning: 'Noble guardian', origin: 'Sanskrit', association: 'A compound name of nobility and protection', themes: 'nobility, protection, and strength' },
  yash: { name: 'Yash', meaning: 'Fame, glory, success', origin: 'Sanskrit', association: 'A classical name of renown', themes: 'glory, success, and charisma' },
  yashwanth: { name: 'Yashwanth', meaning: 'One who is famous and successful', origin: 'Sanskrit', association: 'A name celebrating glory and achievement', themes: 'achievement, fame, and confidence' },
  pranav: { name: 'Pranav', meaning: 'The sacred syllable Om', origin: 'Sanskrit', association: 'A name of the primordial sacred sound', themes: 'spirituality, meditation, and depth' },
  shiva: { name: 'Shiva', meaning: 'Auspicious, benevolent', origin: 'Sanskrit', association: 'The name of the great lord of transformation', themes: 'auspiciousness, transformation, and strength' },
  krishna: { name: 'Krishna', meaning: 'Dark, attractive; the divine charmer', origin: 'Sanskrit', association: 'The celebrated incarnation of Vishnu', themes: 'charm, devotion, and wisdom' },
  sita: { name: 'Sita', meaning: 'Furrow; from the earth', origin: 'Sanskrit', association: 'The devoted heroine of the Ramayana', themes: 'devotion, purity, and strength' },
  ram: { name: 'Ram', meaning: 'Pleasing, delightful; the ideal king', origin: 'Sanskrit', association: 'The heroic central figure of the Ramayana', themes: 'virtue, duty, and courage' },
  lakshmi: { name: 'Lakshmi', meaning: 'Good fortune, prosperity, the goddess of wealth', origin: 'Sanskrit', association: 'The goddess of fortune and abundance', themes: 'prosperity, grace, and abundance' },
  ganesh: { name: 'Ganesh', meaning: 'Lord of the ganas; remover of obstacles', origin: 'Sanskrit', association: 'The beloved elephant-headed deity', themes: 'wisdom, beginnings, and removal of obstacles' },
  kavya: { name: 'Kavya', meaning: 'Poetry, a poem, the poetic art', origin: 'Sanskrit', association: 'A name of the literary arts', themes: 'creativity, eloquence, and artistry' },
  riya: { name: 'Riya', meaning: 'Singer, melodious', origin: 'Sanskrit', association: 'A name of music and song', themes: 'melody, joy, and expression' },
  meera: { name: 'Meera', meaning: 'Beloved of Krishna; a celebrated poet-saint', origin: 'Sanskrit', association: 'The devotional poet-saint of Rajasthan', themes: 'devotion, love, and surrender' },
  aaradhya: { name: 'Aaradhya', meaning: 'Worthy of worship', origin: 'Sanskrit', association: 'A modern devotional name', themes: 'devotion, reverence, and love' },
  vihaan: { name: 'Vihaan', meaning: 'Dawn, morning', origin: 'Sanskrit', association: 'A name of the rising day', themes: 'dawn, freshness, and hope' },
  vedika: { name: 'Vedika', meaning: 'Altar, sacred platform; also a series of ancient texts', origin: 'Sanskrit', association: 'A name of the sacred and the learned', themes: 'sacredness, knowledge, and devotion' },
  sahil: { name: 'Sahil', meaning: 'Guide, friend, leader', origin: 'Arabic', association: 'A classical name of guidance', themes: 'guidance, friendship, and leadership' },
  imran: { name: 'Imran', meaning: 'Prosperity, long-lived', origin: 'Arabic', association: 'A classical Arabic name of blessing', themes: 'prosperity, blessing, and strength' },
  nadia: { name: 'Nadia', meaning: 'Tender, delicate, hope', origin: 'Slavic', association: 'A European name of gentle grace', themes: 'tenderness, hope, and grace' }
};

// Pythagorean letter-value map.
const LETTER_VALUES = {
  a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9,
  j: 1, k: 2, l: 3, m: 4, n: 5, o: 6, p: 7, q: 8, r: 9,
  s: 1, t: 2, u: 3, v: 4, w: 5, x: 6, y: 7, z: 8
};

const NUMBER_THEMES = {
  1: 'independence, leadership, and new beginnings',
  2: 'cooperation, balance, and partnership',
  3: 'creativity, expression, and joy',
  4: 'stability, discipline, and building solid foundations',
  5: 'freedom, adaptability, and change',
  6: 'harmony, responsibility, and care',
  7: 'introspection, wisdom, and spiritual depth',
  8: 'ambition, material mastery, and resilience',
  9: 'compassion, completion, and service'
};

function normalizeName(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function nameNumber(name) {
  const letters = String(name || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (!letters) return null;
  let sum = 0;
  for (const ch of letters) {
    const v = LETTER_VALUES[ch];
    if (v) sum += v;
  }
  return ((sum - 1) % 9) + 1;
}

function themeForNumber(n) {
  return NUMBER_THEMES[n] || 'a dynamic and evolving personal path';
}

/**
 * Produce a truthful name-meaning context for a follow-up question.
 * @param {string} rawName - the name extracted from the question
 * @returns {object} { name, recognized, summary, meaning?, origin?, association? }
 */
function buildNameMeaningContext(rawName) {
  const name = normalizeName(rawName);
  if (!name) {
    return { name: rawName || '', recognized: false, summary: '' };
  }

  const entry = NAME_LEXICON[name];
  if (entry) {
    const association = entry.association.charAt(0).toLowerCase() + entry.association.slice(1);
    return {
      name: entry.name,
      recognized: true,
      meaning: entry.meaning,
      origin: entry.origin,
      association: entry.association,
      themes: entry.themes,
      summary: 'The name ' + entry.name + ' comes from ' + entry.origin +
        ' and is traditionally associated with ' + association +
        '. In classical usage it carries themes of ' + entry.themes + '.'
    };
  }

  const number = nameNumber(rawName);
  const summary = number
    ? 'The name "' + String(rawName).trim() + '" is not in PalmPyaar\'s curated name lexicon, so we won\'t claim a fixed etymology for it. As a neutral reference, its letters reduce to name number ' + number +
      ', which in the classical Pythagorean system is linked to ' + themeForNumber(number) + '.'
    : 'The name provided couldn\'t be read clearly, so no meaning is claimed for it.';

  return {
    name: String(rawName || '').trim(),
    recognized: false,
    number: number,
    summary: summary
  };
}

module.exports = {
  buildNameMeaningContext,
  nameNumber,
  themeForNumber,
  normalizeName,
  NAME_LEXICON,
  NUMBER_THEMES
};
