/**
 * PalmPyaar Language Detector
 *
 * Lightweight Unicode script-based language detection for the follow-up
 * question answer system. No external dependencies. Designed for runtime
 * detection of the language the user asked in so the AI answer can be
 * generated in the same language.
 *
 * Supported detection:
 * - English (latin)
 * - Hindi (Devanagari)
 * - Bengali (Bengali)
 * - Telugu (Telugu)
 * - Marathi (Devanagari — same script as Hindi, disambiguated by common words)
 * - Tamil (Tamil)
 * - Gujarati (Gujarati)
 * - Kannada (Kannada)
 * - Malayalam (Malayalam)
 * - Punjabi (Gurmukhi)
 * - Odia (Odia)
 * - Assamese (Assamese)
 * - Urdu (Arabic + Urdu-specific)
 * - Sanskrit (Devanagari — disambiguated)
 * - Nepali (Devanagari — disambiguated)
 * - Sinhala (Sinhala)
 *
  * Romanized/mixed forms are detected using distinctive romanized word patterns.
  * For example: "naaku" -> telugu, "meri" -> hindi, "enakku" -> tamil.
  */

'use strict';

const SCRIPT_RANGES = {
  devanagari: { start: 0x0900, end: 0x097F, languages: ['hindi', 'marathi', 'sanskrit', 'nepali'] },
  bengali: { start: 0x0980, end: 0x09FF, languages: ['bengali', 'assamese'] },
  telugu: { start: 0x0C00, end: 0x0C7F, languages: ['telugu'] },
  tamil: { start: 0x0B80, end: 0x0BFF, languages: ['tamil'] },
  gujarati: { start: 0x0A80, end: 0x0AFF, languages: ['gujarati'] },
  kannada: { start: 0x0C80, end: 0x0CFF, languages: ['kannada'] },
  malayalam: { start: 0x0D00, end: 0x0D7F, languages: ['malayalam'] },
  gurmukhi: { start: 0x0A00, end: 0x0A7F, languages: ['punjabi'] },
  oriya: { start: 0x0B00, end: 0x0B7F, languages: ['odia'] },
  sinhala: { start: 0x0D80, end: 0x0DFF, languages: ['sinhala'] },
  arabic: { start: 0x0600, end: 0x06FF, languages: ['urdu'] }
};

const DEVANAGARI_DISAMBIGUATION = {
  hindi: [
    'मैं', 'तुम', 'आप', 'क्या', 'है', 'मेरा', 'तेरा', 'आपका', 'नहीं', 'हां',
    'बिल्कुल', 'कैसे', 'कब', 'कहां', 'क्यों', 'कौन', 'कितना', 'प्यार', 'शादी',
    'नौकरी', 'पैसा', 'शिक्षा', 'परिवार', 'मसला', 'जीवन', 'कल', 'आज', 'कल',
    'राज', 'सिंह', 'विजय', 'कुमार', 'देव', 'शर्मा', 'गुप्त', 'पटेल'
  ],
  marathi: [
    'मी', 'तू', 'आपण', 'काय', 'आहे', 'माझा', 'तुझा', 'आपला', 'नाही', 'होय',
    'कसे', 'केव्हा', 'कुठे', 'का', 'कोण', 'किती', 'प्रेम', 'लग्न', 'नोकरी',
    'पैसे', 'शिक्षण', 'कुटुंब', 'समस्य', 'जीवन', 'उद्य', 'आज', 'काळ',
    'राज', 'सिंह', 'विजय', 'कुमार', 'देव', 'शर्मा', 'गुप्त', 'पटेल', 'मराठी'
  ],
  sanskrit: [
    'अहं', 'त्वं', 'भवान्', 'किं', 'अस्ति', 'मम', 'तव', 'भवतः', 'न', 'आम्',
    'कथं', 'कदा', 'कुत्र', 'कस्मात्', 'कः', 'कति', 'प्रेम', 'विवाह', 'व्यवसाय',
    'धन', 'विद्या', 'कुटुंब', 'समस्या', 'जीवन', 'अद्य', 'स्वः', 'काल',
    'वेद', 'शास्त्र', 'धर्म', 'कर्म', 'मोक्ष', 'आत्मा', 'ब्रह्म'
  ],
  nepali: [
    'म', 'तिमी', 'तपाईं', 'के', 'छ', 'मेरो', 'तिम्रो', 'तपाईंको', 'छैन', 'हो',
    'कसरी', 'कहिले', 'कहाँ', 'किन', 'को', 'कति', 'प्रेम', 'विवाह', 'काम',
    'पैसा', 'शिक्षा', 'परिवार', 'समस्या', 'जीवन', 'भोलि', 'आज', 'काल',
    'राज', 'सिंह', 'विजय', 'कुमार', 'देव', 'शर्मा', 'गुप्त', 'पटेल', 'नेपाली'
  ]
};

const BENGALI_DISAMBIGUATION = {
  bengali: [
    'আমি', 'তুমি', 'আপনি', 'কি', 'হয়', 'আমার', 'তোমার', 'আপনার', 'না', 'হ্যাঁ',
    'কিভাবে', 'কখন', 'কোথায়', 'কেন', 'কে', 'কত', 'ভালোবাসা', 'বিয়ে', 'চাকরি',
    'টাকা', 'শিক্ষা', 'পরিবার', 'সমস্যা', 'জীবন', 'কাল', 'আজ', 'রাজ',
    'বাংলা', 'দেশ', 'গল্প', 'সinet', 'বন্ধু', 'মা', 'বাবা'
  ],
  assamese: [
    'মই', 'তুমি', 'আপনি', 'কি', 'আছে', 'মোৰ', 'তোমাৰ', 'আপোনাৰ', 'নহয়', 'হয়',
    'কিভাবে', 'কetheless', 'কোথা', 'কিয়োনো', 'কোন', 'কেতিয়া', 'ভাল',
    'বিয়ে', 'কাম', 'টাকা', 'শিক্ষা', 'পৰিজন', 'সমস্যা', 'জীৱন', 'কาลি',
    'আজি', 'অসমীয়া', 'দেশ', 'গল্প', 'বন্ধু', 'মাই', 'দেউতা'
  ]
};

/**
 * Distinctive romanized words, matched as WHOLE TOKENS.
 *
 * The old implementation used `lower.includes(word)`, which classified
 * "thailand" as Hindi (contains "hai") and "elaa" inside longer English
 * words. Whole-token matching plus explicit spelling variants (naku/naaku,
 * ela/elaa, eppudu/epudu, untundi/untundhi, eppothu/eppothum) keeps genuine
 * English questions English while catching how customers actually type.
 *
 * Weights: a language must reach score >= 4 with at least 2 distinct
 * matches, or score >= 6 from a single very distinctive word. One weak
 * common word can never reclassify a question.
 */
const ROMANIZED_DISTINCTIVE = {
  telugu: [
    ['chesthunnaru', 5], ['chestunnaru', 5], ['chesthunaru', 5],
    ['vastundi', 4], ['vastundhi', 4], ['vachchindi', 4], ['vachindi', 4],
    ['avutundi', 4], ['avuthundi', 4], ['avutundhi', 4],
    ['unchundi', 4], ['chestunnay', 4],
    ['naaku', 3], ['naku', 3], ['meeru', 3], ['eppudu', 3], ['epudu', 3],
    ['yeppudu', 3], ['eppatiki', 3], ['eppatiko', 3], ['pelli', 3],
    ['jivita', 3], ['elaa', 2], ['ela', 2]
  ],
  hindi: [
    ['bhai', 3], ['pyaar', 3], ['shadi', 3], ['naukri', 3], ['nokri', 3],
    ['paise', 3], ['padhai', 3], ['parivar', 3], ['zindagi', 3],
    ['kuchh', 3], ['samajh', 3], ['karonga', 3], ['hogi', 3], ['milegi', 3],
    ['meri', 2], ['kya', 2], ['hai', 2], ['nahi', 2], ['mera', 2],
    ['tera', 2], ['uska', 2], ['kab', 2], ['kaise', 3], ['hoga', 3],
    ['karna', 3], ['raha', 2]
  ],
  tamil: [
    ['kaadhal', 4], ['thozhil', 3], ['vazhkai', 3], ['velai', 3],
    ['eppothum', 4], ['eppothu', 3], ['varum', 3], ['engae', 3],
    ['irukkum', 3], ['aagirukum', 4], ['aayirum', 4],
    ['enna', 2], ['eppo', 2], ['epdi', 2]
  ],
  bengali: [
    ['bhalobasha', 4], ['shomossa', 4], ['biye', 3], ['chakri', 3],
    ['kobe', 3], ['hobe', 3], ['amar', 3], ['kothay', 3], ['kivabe', 3],
    ['poribar', 3], ['shikkha', 3], ['jibon', 3]
  ],
  marathi: [
    ['aapan', 3], ['kadhihi', 4], ['kasa', 3], ['tula', 3],
    ['mala', 3], ['kutha', 3], ['lagan', 3], ['shikshan', 4], ['samasya', 4]
  ]
};


function detectScriptRanges(text) {
  const counts = {};
  for (const char of text) {
    const code = char.charCodeAt(0);
    for (const [script, range] of Object.entries(SCRIPT_RANGES)) {
      if (code >= range.start && code <= range.end) {
        counts[script] = (counts[script] || 0) + 1;
        break;
      }
    }
  }
  return counts;
}

/**
 * Score a Latin-only question against the romanized lexicons.
 * Returns a language code only when the match is strong enough that a
 * genuine English question can never be misclassified.
 */
function detectRomanizedLanguage(text) {
  const tokens = String(text || '').toLowerCase().match(/[a-z']+/g) || [];
  if (tokens.length === 0) return null;
  const tokenSet = new Set(tokens);

  const ranked = Object.entries(ROMANIZED_DISTINCTIVE).map(([lang, words]) => {
    let score = 0;
    let distinct = 0;
    let strong = 0;
    for (const [word, weight] of words) {
      if (tokenSet.has(word)) {
        score += weight;
        distinct += 1;
        if (weight > strong) strong = weight;
      }
    }
    return { lang, score, distinct, strong };
  }).sort((a, b) => b.score - a.score);

  for (const entry of ranked) {
    if (entry.strong >= 4) return entry.lang;
    if (entry.score >= 4 && entry.distinct >= 2) return entry.lang;
  }

  return null;
}

function detectLanguageFromScript(scriptCounts) {
  const total = Object.values(scriptCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'english';

  const dominantScript = Object.entries(scriptCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  if (dominantScript === 'devanagari') {
    return disambiguateDevanagari(scriptCounts);
  }
  if (dominantScript === 'bengali') {
    return disambiguateBengali(scriptCounts);
  }
  if (dominantScript === 'arabic') {
    return 'urdu';
  }

  const scriptToLang = {
    telugu: 'telugu',
    tamil: 'tamil',
    gujarati: 'gujarati',
    kannada: 'kannada',
    malayalam: 'malayalam',
    gurmukhi: 'punjabi',
    oriya: 'odia',
    sinhala: 'sinhala'
  };

  return scriptToLang[dominantScript] || 'english';
}

function disambiguateDevanagari(scriptCounts) {
  const devanagariChars = scriptCounts.devanagari || 0;
  if (devanagariChars === 0) return 'hindi';

  const scores = { hindi: 0, marathi: 0, sanskrit: 0, nepali: 0 };

  for (const [lang, words] of Object.entries(DEVANAGARI_DISAMBIGUATION)) {
    for (const word of words) {
      const regex = new RegExp(word, 'g');
      const matches = (scriptCounts['_text'] || '').match(regex);
      if (matches) {
        scores[lang] += matches.length * word.length;
      }
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) {
    return best[0];
  }

  if (devanagariChars >= 3) return 'hindi';
  return 'english';
}

function disambiguateBengali(scriptCounts) {
  const bengaliChars = scriptCounts.bengali || 0;
  if (bengaliChars === 0) return 'bengali';

  const scores = { bengali: 0, assamese: 0 };
  const text = scriptCounts['_text'] || '';

  for (const [lang, words] of Object.entries(BENGALI_DISAMBIGUATION)) {
    for (const word of words) {
      const regex = new RegExp(word, 'g');
      const matches = text.match(regex);
      if (matches) {
        scores[lang] += matches.length * word.length;
      }
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 0) {
    return best[0];
  }

  return 'bengali';
}

function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'english';

  const trimmed = text.trim();
  if (trimmed.length === 0) return 'english';

  const scriptCounts = detectScriptRanges(trimmed);
  const scriptTotal = Object.entries(scriptCounts)
    .filter(([k]) => k !== '_text')
    .reduce((sum, [, v]) => sum + v, 0);

  if (scriptTotal >= 2) {
    scriptCounts['_text'] = trimmed;
    return detectLanguageFromScript(scriptCounts);
  }

  const romanized = detectRomanizedLanguage(trimmed);
  if (romanized) return romanized;

  const latinRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;
  if (latinRatio > 0.7) return 'english';

  return 'english';
}

function getLanguageDisplayName(code) {
  const names = {
    english: 'English',
    hindi: 'Hindi',
    bengali: 'Bengali',
    telugu: 'Telugu',
    marathi: 'Marathi',
    tamil: 'Tamil',
    gujarati: 'Gujarati',
    kannada: 'Kannada',
    malayalam: 'Malayalam',
    punjabi: 'Punjabi',
    odia: 'Odia',
    assamese: 'Assamese',
    urdu: 'Urdu',
    sanskrit: 'Sanskrit',
    nepali: 'Nepali',
    sinhala: 'Sinhala'
  };
  return names[code] || 'English';
}

module.exports = {
  detectLanguage,
  getLanguageDisplayName
};
