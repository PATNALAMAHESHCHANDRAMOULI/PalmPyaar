/**
 * PalmPyaar Timing Engine
 *
 * Derives a defensible, per-user timing window for follow-up questions from
 * the data the astrology engine ALREADY computes (see lib/astrologyProvider.js).
 * No universal years are hardcoded: the windows are driven by the user's birth
 * date, ascendant sign, and (for Vedic) their actual Vimshottari Dasha balance
 * and Antardasha (Bhukti) schedule.
 *
 * Techniques used:
 *  1. Vimshottari Mahadasha + Antardasha schedule (Vedic tradition). The birth
 *     Mahadasha lord and balance come from astrologyProvider.calculateDasha(),
 *     which resolves exact period dates. We walk the classical 9-lord sequence
 *     forward, subdivide every Mahadasha into its nine proportional Antardashas
 *     (MD years x AD years / 120), locate the period active NOW, and score the
 *     topic's significator lords. Antardasha-level periods out-rank whole
 *     Mahadashas so a narrow, meaningful window is preferred over a broad one.
 *  2. Annual profections (classical; primary for Western/Hellenistic, optional
 *     corroborating evidence for Vedic). The ascendant advances one sign per
 *     year of life. For each future year we compute the age, the activated
 *     natal house, the activated sign, the lord of that sign, and a topic
 *     relevance score, instead of relying on birth-year residue alone.
 *
 * The output is a compact context object consumed by the AI prompt and by the
 * deterministic answer builder. It deliberately uses hedged, non-guaranteed
 * framing ("strongest window", "appears", "suggests").
 */

'use strict';

const DASHA_ORDER = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];

// Canonical Vimshottari years: 7+20+6+10+7+18+16+19+17 = 120.
const DASHA_YEARS = {
  ketu: 7,
  venus: 20,
  sun: 6,
  moon: 10,
  mars: 7,
  rahu: 18,
  jupiter: 16,
  saturn: 19,
  mercury: 17
};

const DAY_MS = 86400000;
const YEAR_DAYS = 365.25;

// 1-based natal houses activated per topic (annual profections). Multiple
// houses are scanned and the strongest future activation is selected.
const TOPIC_HOUSES = {
  'career/job': [10, 6, 2, 11],
  'money': [2, 8, 11],
  'education': [5, 9],
  'marriage': [7, 5],
  'relationship/love': [7, 5],
  'intimacy': [8, 5],
  'family': [4],
  'children': [5, 11],
  'travel/relocation': [9, 12, 3, 4],
  'personality': [1],
  'life-direction': [10, 1, 9],
  'opportunities/future': [11, 10, 1],
  'compatibility': [7],
  'general': [1, 10]
};

// The single strongest natal house for each topic, used to rank profection years.
const TOPIC_PRIMARY_HOUSE = {
  'career/job': 10,
  'money': 2,
  'education': 5,
  'marriage': 7,
  'relationship/love': 7,
  'intimacy': 8,
  'family': 4,
  'children': 5,
  'travel/relocation': 12,
  'personality': 1,
  'life-direction': 10,
  'opportunities/future': 11,
  'compatibility': 7,
  'general': 10
};

// Vedic significators (graha karakas) per topic, used with the Dasha schedule.
const TOPIC_SIGNIFICATORS = {
  'career/job': ['saturn', 'sun', 'jupiter', 'mercury', 'mars'],
  'money': ['jupiter', 'venus', 'mercury', 'saturn'],
  'education': ['jupiter', 'mercury'],
  'marriage': ['venus', 'jupiter', 'moon'],
  'relationship/love': ['venus', 'moon', 'jupiter', 'mars'],
  'intimacy': ['venus', 'mars'],
  'family': ['moon', 'venus'],
  'children': ['jupiter'],
  'travel/relocation': ['jupiter', 'moon', 'mercury', 'rahu'],
  'personality': ['sun', 'moon'],
  'life-direction': ['jupiter', 'saturn', 'sun'],
  'opportunities/future': ['jupiter', 'sun', 'mercury'],
  'compatibility': ['venus', 'moon', 'jupiter'],
  'general': ['jupiter', 'sun', 'moon']
};

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

// Classical rulers of the twelve signs (used for the lord of the activated
// sign in annual profections and for significator reasoning).
const SIGN_RULERS = [
  'mars',    // Aries
  'venus',   // Taurus
  'mercury', // Gemini
  'moon',    // Cancer
  'sun',     // Leo
  'mercury', // Virgo
  'venus',   // Libra
  'mars',    // Scorpio
  'jupiter', // Sagittarius
  'saturn',  // Capricorn
  'saturn',  // Aquarius
  'jupiter'  // Pisces
];

const ORDINALS = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th',
  7: '7th', 8: '8th', 9: '9th', 10: '10th', 11: '11th', 12: '12th'
};

const LABEL_BY_TOPIC = {
  'career/job': 'CAREER WINDOW',
  'money': 'FINANCIAL WINDOW',
  'education': 'STUDY WINDOW',
  'marriage': 'MARRIAGE WINDOW',
  'relationship/love': 'RELATIONSHIP WINDOW',
  'intimacy': 'INTIMACY WINDOW',
  'family': 'FAMILY WINDOW',
  'children': 'CHILDREN WINDOW',
  'travel/relocation': 'FOREIGN MOVE WINDOW',
  'personality': 'SELF-REFLECTION WINDOW',
  'life-direction': 'TRANSITION WINDOW',
  'opportunities/future': 'OPPORTUNITY WINDOW',
  'compatibility': 'PARTNERSHIP WINDOW',
  'general': 'OUTLOOK WINDOW'
};

function parseYear(dob) {
  if (!dob) return null;
  const m = String(dob).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function yearFromDate(iso) {
  const d = new Date(iso);
  return isFinite(d.getTime()) ? d.getUTCFullYear() : null;
}

function ordinal(n) {
  return ORDINALS[n] || (n + 'th');
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function signIndex(sign) {
  return ZODIAC_SIGNS.indexOf(sign);
}

/**
 * Subdivide one Mahadasha into its nine proportional Antardashas.
 * Each Bhukti duration = MD years x Bhukti lord years / 120, sequenced in the
 * standard Vimshottari order starting from the Mahadasha lord.
 * @param {string} mdLord
 * @param {number} startMs - Mahadasha start (epoch ms)
 * @param {number} endMs - Mahadasha end (epoch ms)
 * @returns {Array<{lord: string, startDate: string, endDate: string, durationYears: number}>}
 */
function buildAntardashas(mdLord, startMs, endMs) {
  const lordIdx = DASHA_ORDER.indexOf(mdLord);
  if (lordIdx === -1) return [];
  const mdDurationMs = endMs - startMs;
  const list = [];
  let cum = 0;
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_ORDER[(lordIdx + i) % 9];
    const fraction = DASHA_YEARS[lord] / 120;
    const start = startMs + cum * mdDurationMs;
    cum += fraction;
    const end = startMs + cum * mdDurationMs;
    list.push({
      lord: lord,
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
      durationYears: (DASHA_YEARS[mdLord] * DASHA_YEARS[lord]) / 120
    });
  }
  return list;
}

/**
 * Build the complete Vimshottari schedule (all Mahadashas with their
 * Antardashas, date-resolved) and identify the period active at the given
 * moment.
 *
 * The birth Mahadasha may already be partially elapsed at birth; its true
 * start and end come from astrologyProvider.calculateDasha() (which derives
 * the balance from the Moon's position within the birth Nakshatra). Subsequent
 * Mahadashas are full periods in the classical lord sequence.
 *
 * @param {object} dasha - astrologyData.vedic.dasha
 * @param {number} birthYear - birth year from DOB
 * @param {number} nowMs - current epoch ms
 * @returns {{mahadashas: Array, currentMD: object|null, currentAD: object|null}}
 */
function buildVedicSchedule(dasha, birthYear, nowMs) {
  const md = dasha && dasha.mahaDasha;
  if (!md || !md.lord) return { mahadashas: [], currentMD: null, currentAD: null };
  const startIdx = DASHA_ORDER.indexOf(md.lord);
  if (startIdx === -1) return { mahadashas: [], currentMD: null, currentAD: null };

  // First Mahadasha boundaries: prefer exact dates from the provider; fall
  // back to a year-based approximation.
  let firstStartMs = md.startDate ? new Date(md.startDate).getTime() : NaN;
  let firstEndMs = md.endDate ? new Date(md.endDate).getTime() : NaN;
  if (!isFinite(firstStartMs) || !isFinite(firstEndMs)) {
    const balanceYears = Number(md.balance) || Number(md.balanceYears) || 0;
    const birthMs = Date.UTC(birthYear, 0, 1);
    firstEndMs = birthMs + balanceYears * YEAR_DAYS * DAY_MS;
    firstStartMs = birthMs - (DASHA_YEARS[md.lord] - balanceYears) * YEAR_DAYS * DAY_MS;
  }

  const mahadashas = [];
  let mStart = firstStartMs;
  let mEnd = firstEndMs;

  const firstMD = {
    lord: md.lord,
    startDate: new Date(mStart).toISOString(),
    endDate: new Date(mEnd).toISOString(),
    antardashas: []
  };
  if (Array.isArray(dasha.antardashas) && dasha.antardashas.length === 9 &&
      dasha.antardashas.every(function (a) { return a.startDate && a.endDate; })) {
    firstMD.antardashas = dasha.antardashas.map(function (a) {
      return {
        lord: a.lord,
        startDate: a.startDate,
        endDate: a.endDate,
        durationYears: Number(a.durationYears) || Number(a.years) || 0
      };
    });
  } else {
    firstMD.antardashas = buildAntardashas(md.lord, mStart, mEnd);
  }
  mahadashas.push(firstMD);

  // Subsequent Mahadashas (full periods), each with its own Antardashas.
  for (let i = 1; i <= 9; i++) {
    const lord = DASHA_ORDER[(startIdx + i) % 9];
    const startMs = mEnd;
    const endMs = startMs + DASHA_YEARS[lord] * YEAR_DAYS * DAY_MS;
    mahadashas.push({
      lord: lord,
      startDate: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
      antardashas: buildAntardashas(lord, startMs, endMs)
    });
    mEnd = endMs;
  }

  // Locate the period active now.
  const now = isFinite(nowMs) ? nowMs : Date.now();
  let currentMD = null;
  let currentAD = null;
  for (const p of mahadashas) {
    const pStart = new Date(p.startDate).getTime();
    const pEnd = new Date(p.endDate).getTime();
    if (now >= pStart && now < pEnd) {
      currentMD = p;
      for (const ad of p.antardashas) {
        const aStart = new Date(ad.startDate).getTime();
        const aEnd = new Date(ad.endDate).getTime();
        if (now >= aStart && now < aEnd) {
          currentAD = ad;
          break;
        }
      }
      break;
    }
  }

  return { mahadashas: mahadashas, currentMD: currentMD, currentAD: currentAD };
}

/**
 * Compute annual profection candidates for the next 12-year cycle. Each
 * candidate is scored on: house activation (always), whether the lord of the
 * activated sign is a topic significator, and whether the activated house is
 * the topic's primary house.
 *
 * @param {object} params
 * @param {number} params.birthYear
 * @param {number} params.currentYear
 * @param {string} params.ascSign - natal ascendant sign in the tradition's frame
 * @param {number[]} params.houses - topic houses to watch
 * @param {string[]} params.significators - topic significators
 * @param {number|null} params.primaryHouse - strongest topic house
 * @returns {Array<{year: number, age: number, house: number, sign: string, ruler: string, strength: number, rulerInSigs: boolean}>}
 */
function profectionCandidates({ birthYear, currentYear, ascSign, houses, significators, primaryHouse }) {
  const ascIdx = signIndex(ascSign);
  if (!birthYear || !Array.isArray(houses) || houses.length === 0 || ascIdx === -1) return [];
  const currentAge = currentYear - birthYear;
  const result = [];
  for (let age = currentAge + 1; age <= currentAge + 12; age++) {
    const activatedHouse = (age % 12) + 1;
    if (houses.indexOf(activatedHouse) === -1) continue;
    const signIdx = (ascIdx + age) % 12;
    const sign = ZODIAC_SIGNS[signIdx];
    const ruler = SIGN_RULERS[signIdx];
    let strength = 1;
    const rulerInSigs = significators.indexOf(ruler) !== -1;
    if (rulerInSigs) strength += 0.5;
    if (activatedHouse === primaryHouse) strength += 0.3;
    result.push({
      year: birthYear + age,
      age: age,
      house: activatedHouse,
      sign: sign,
      ruler: ruler,
      strength: strength,
      rulerInSigs: rulerInSigs
    });
  }
  result.sort(function (a, b) {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return a.year - b.year;
  });
  return result;
}

/**
 * Build the future Vimshottari Mahadasha timeline from the balance the
 * astrology engine computed at birth (kept for lightweight/backward-compatible
 * callers). Uses the fractional balance to avoid rounding away precision.
 * @param {object} dasha - astrologyData.vedic.dasha
 * @param {number} birthYear - birth year from DOB
 * @returns {Array<{lord: string, startYear: number, endYear: number, isCurrent: boolean}>}
 */
function buildDashaTimeline(dasha, birthYear) {
  const md = dasha && dasha.mahaDasha;
  if (!md || !md.lord) return [];
  const startIdx = DASHA_ORDER.indexOf(md.lord);
  if (startIdx === -1) return [];
  const balanceYears = Number(md.balance) || Number(md.balanceYears) || 0;
  const timeline = [];
  let year = birthYear + balanceYears;
  timeline.push({ lord: md.lord, startYear: birthYear, endYear: Math.floor(year), isCurrent: true });
  for (let i = 1; i <= 9; i++) {
    const idx = (startIdx + i) % 9;
    const lord = DASHA_ORDER[idx];
    const start = year;
    const end = start + DASHA_YEARS[lord];
    timeline.push({ lord: lord, startYear: Math.floor(start), endYear: Math.floor(end), isCurrent: false });
    year = end;
  }
  return timeline;
}

/**
 * Determine the first future year (in the next 12-year cycle) in which an
 * annual profection activates one of the given natal houses (kept for
 * lightweight/backward-compatible callers).
 * @param {number} birthYear - birth year from DOB
 * @param {number} currentYear - current calendar year
 * @param {number[]} houses - 1-based natal houses to watch
 * @returns {number|null} calendar year, or null if none found
 */
function nextProfectionsYear(birthYear, currentYear, houses) {
  if (!birthYear || !Array.isArray(houses) || houses.length === 0) return null;
  const currentAge = currentYear - birthYear;
  for (let age = currentAge + 1; age <= currentAge + 12; age++) {
    for (const house of houses) {
      if (age % 12 === (house - 1) % 12) {
        return birthYear + age;
      }
    }
  }
  return null;
}

/**
 * Resolve the ascendant sign in the tradition's own frame.
 * @returns {string|null}
 */
function getAscendantSign(astrologyData, tradition) {
  if (!astrologyData || !astrologyData.ascendant) return null;
  const mode = tradition === 'western' ? 'tropical' : 'sidereal';
  const pos = astrologyData.ascendant[mode];
  if (pos && pos.sign) return pos.sign;
  const fallback = astrologyData.ascendant.tropical || astrologyData.ascendant.sidereal;
  return fallback && fallback.sign ? fallback.sign : null;
}

function topicHouseFor(topic) {
  return TOPIC_HOUSES[topic] || null;
}

function significatorsFor(topic) {
  return TOPIC_SIGNIFICATORS[topic] || [];
}

function primaryHouseFor(topic) {
  return TOPIC_PRIMARY_HOUSE[topic] || null;
}

function topicLabel(topic) {
  return LABEL_BY_TOPIC[topic] || 'OUTLOOK WINDOW';
}

function formatWindow(startYear, endYear) {
  const start = String(startYear);
  const end = String(endYear);
  return start === end ? start : start + '-' + end;
}

/**
 * Derive the best timing window for a user's follow-up question.
 *
 * Evidence is combined, not selected blindly:
 *  - Vedic: Antardasha-level significator periods (weight 3) out-rank a
 *    running Antardasha (2.6), which out-ranks whole Mahadashas (2 current,
 *    1.5 running), which out-rank profections (1, optional corroboration).
 *  - Western/Hellenistic: annual profections (primary, weight ~2-2.8, scored
 *    by activated house/sign/lord). No Vedic data is mixed in.
 *
 * @param {object} params
 * @param {object} [params.astrologyData] - Full chart from calculateChart()
 * @param {string} params.tradition - 'western' | 'vedic' | 'hellenic'
 * @param {string} [params.dob] - YYYY-MM-DD
 * @param {object} params.intent - { topic, timing }
 * @param {Date|number} [params.now] - injectable "now" for tests
 * @returns {object} Timing context for the answer builders
 */
function deriveTimingWindow({ astrologyData, tradition, dob, intent, now }) {
  const topic = intent && intent.topic ? intent.topic : 'general';
  const birthYear = parseYear(dob);
  const currentDate = now ? new Date(now) : new Date();
  const currentYear = currentDate.getFullYear();

  if (!birthYear || topic === 'name-meaning') {
    return { supported: false, topic: topic };
  }

  const candidates = [];
  const sigs = significatorsFor(topic);
  const houses = topicHouseFor(topic);
  const primaryHouse = primaryHouseFor(topic);
  const ascSign = getAscendantSign(astrologyData, tradition);
  const nakshatraName = astrologyData && astrologyData.vedic && astrologyData.vedic.nakshatra
    ? astrologyData.vedic.nakshatra.name
    : '';

  const isVedic = tradition === 'vedic' && astrologyData && astrologyData.vedic && astrologyData.vedic.dasha;

  // 1. Vimshottari Mahadasha + Antardasha (primary for Vedic).
  if (isVedic) {
    const schedule = buildVedicSchedule(astrologyData.vedic.dasha, birthYear, currentDate.getTime());
    const nowMs = currentDate.getTime();

    for (const md of schedule.mahadashas) {
      const mdStartMs = new Date(md.startDate).getTime();
      const mdEndMs = new Date(md.endDate).getTime();
      const isCurrentMD = md === schedule.currentMD;

      // Antardasha-level candidates (narrowest signal).
      for (const ad of md.antardashas) {
        const adStartMs = new Date(ad.startDate).getTime();
        const adEndMs = new Date(ad.endDate).getTime();
        if (adEndMs <= nowMs) continue; // fully elapsed
        if (sigs.indexOf(ad.lord) === -1) continue; // not a topic significator
        const isCurrentAD = ad === schedule.currentAD;
        const startYear = Math.max(yearFromDate(ad.startDate), currentYear);
        const endYear = yearFromDate(ad.endDate);
        if (endYear < currentYear) continue;
        candidates.push({
          startYear: startYear,
          endYear: endYear,
          startDate: ad.startDate,
          endDate: ad.endDate,
          method: 'vimshottari-dasha',
          level: 'antardasha',
          current: isCurrentAD,
          weight: isCurrentAD ? 2.6 : 3,
          lord: ad.lord,
          mahadashaLord: md.lord,
          label: titleCase(ad.lord) + ' Antardasha in ' + titleCase(md.lord) + ' Mahadasha',
          indicator: isCurrentAD
            ? 'the ' + titleCase(ad.lord) + ' Antardasha of the current ' + titleCase(md.lord) + ' Mahadasha, running now through ' + endYear
            : 'the ' + titleCase(ad.lord) + ' Antardasha within the ' + titleCase(md.lord) + ' Mahadasha in ' + formatWindow(startYear, endYear)
        });
      }

      // Mahadasha-level candidates (broader fallback, never preferred over AD).
      if (sigs.indexOf(md.lord) === -1) continue;
      if (mdEndMs <= nowMs) continue;
      const mdStartYear = Math.max(yearFromDate(md.startDate), currentYear);
      const mdEndYear = yearFromDate(md.endDate);
      if (mdEndYear < currentYear) continue;
      candidates.push({
        startYear: mdStartYear,
        endYear: mdEndYear,
        startDate: md.startDate,
        endDate: md.endDate,
        method: 'vimshottari-dasha',
        level: 'mahadasha',
        current: isCurrentMD,
        weight: isCurrentMD ? 1.5 : 2,
        lord: md.lord,
        mahadashaLord: null,
        label: (isCurrentMD ? 'current ' : '') + titleCase(md.lord) + ' Mahadasha',
        indicator: isCurrentMD
          ? 'the ' + titleCase(md.lord) + ' Mahadasha (a significator for ' + topic + ') running through ' + mdEndYear
          : 'the start of the ' + titleCase(md.lord) + ' Mahadasha (a significator for ' + topic + ') in ' + mdStartYear
      });
    }
  }

  // 2. Annual profections (primary for Western/Hellenistic, optional for Vedic).
  if (ascSign && houses && houses.length) {
    const profs = profectionCandidates({
      birthYear: birthYear,
      currentYear: currentYear,
      ascSign: ascSign,
      houses: houses,
      significators: sigs,
      primaryHouse: primaryHouse
    });
    if (profs.length) {
      const best = profs[0];
      const weight = isVedic
        ? 1
        : 2 + (best.rulerInSigs ? 0.5 : 0) + (best.house === primaryHouse ? 0.3 : 0);
      candidates.push({
        startYear: best.year,
        endYear: best.year,
        startDate: null,
        endDate: null,
        method: 'annual-profections',
        level: 'profections',
        current: false,
        weight: weight,
        house: best.house,
        sign: best.sign,
        ruler: best.ruler,
        rulerInSigs: best.rulerInSigs,
        label: 'annual profection activating the ' + ordinal(best.house) + ' house',
        indicator: 'the annual profection activates the ' + ordinal(best.house) + ' house in ' + best.year +
          ', with ' + titleCase(best.ruler) + ' ruling the activated ' + best.sign + ' sign'
      });
    }
  }

  if (candidates.length === 0) {
    return { supported: false, topic: topic };
  }

  // Prefer the strongest evidence; among equals, the earliest window.
  candidates.sort(function (a, b) {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.startYear - b.startYear;
  });

  const primary = candidates[0];
  const secondary = candidates[1] || null;

  const windowText = formatWindow(primary.startYear, primary.endYear);

  const indicators = [primary.indicator];
  if (secondary) {
    indicators.push(secondary.indicator);
  }

  let reasoning;
  if (primary.method === 'vimshottari-dasha') {
    const basis = 'based on the Moon\'s birth Nakshatra' +
      (nakshatraName ? ' (' + nakshatraName + ')' : '') + ' and the calculated balance';
    if (primary.level === 'antardasha') {
      reasoning = 'The Vimshottari Dasha places the ' + titleCase(primary.lord) +
        ' Antardasha inside the ' + titleCase(primary.mahadashaLord) + ' Mahadasha across ' + windowText +
        (primary.current ? ' (running now)' : '') + ', ' + basis + '.';
    } else {
      reasoning = 'The Vimshottari Dasha places the ' + titleCase(primary.lord) +
        ' Mahadasha across ' + windowText + (primary.current ? ' (running now)' : '') + ', ' + basis + '.';
    }
  } else {
    reasoning = 'The annual profection cycle advances the ascendant one sign per year of life. In ' +
      windowText + ' it activates the ' + ordinal(primary.house) + ' house, with ' +
      titleCase(primary.ruler) + ' ruling the activated ' + primary.sign + ' sign' +
      (primary.rulerInSigs ? ', and ' + titleCase(primary.ruler) + ' is a direct ' + topic + ' indicator' : '') + '.';
  }

  return {
    supported: true,
    topic: topic,
    label: topicLabel(topic),
    window: {
      startYear: primary.startYear,
      endYear: primary.endYear,
      text: windowText
    },
    method: primary.method,
    reasoning: reasoning,
    indicators: indicators.slice(0, 3)
  };
}

module.exports = {
  deriveTimingWindow,
  buildDashaTimeline,
  buildVedicSchedule,
  buildAntardashas,
  profectionCandidates,
  nextProfectionsYear,
  formatWindow,
  topicHouseFor,
  significatorsFor,
  primaryHouseFor,
  topicLabel,
  getAscendantSign,
  parseYear,
  yearFromDate,
  DASHA_ORDER,
  DASHA_YEARS,
  TOPIC_HOUSES,
  TOPIC_SIGNIFICATORS,
  ZODIAC_SIGNS
};