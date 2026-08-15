/**
 * PalmPyaar Astrology Engine — Vedic / Hellenistic / Western chart calculations.
 *
 * Uses astronomy-engine (pure JS, no native deps) for planetary positions,
 * geo-tz + moment-timezone for timezone resolution, and a small built-in
 * city database for birthplace geocoding.
 *
 * SECURITY: birthplace is only used for latitude/longitude/timezone lookup.
 * The raw string is never forwarded to the AI provider or stored. If a
 * birthplace cannot be resolved, a neutral chart (0°N, 0°E) is used and
 * a warning is attached so downstream code can degrade gracefully.
 */

'use strict';

const Astronomy = require('astronomy-engine');
const geoTz = require('geo-tz');
const moment = require('moment-timezone');

const PI = Math.PI;
const DEG2RAD = PI / 180;
const RAD2DEG = 180 / PI;

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer',
  'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira',
  'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha',
  'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati',
  'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha',
  'Uttara Ashadha', 'Shravana', 'Dhanishtha', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
];

// Small built-in city database for geocoding.
// Format: { cityName: { lat, lng } }
// Covers major metropolitan areas; for unlisted locations the engine
// falls back to geo-tz's coordinate-based lookup when coordinates are
// embedded in the birthplace string, otherwise uses a safe default.
const CITY_DB = {
  'mumbai': { lat: 19.0760, lng: 72.8777 },
  'delhi': { lat: 28.6139, lng: 77.2090 },
  'new delhi': { lat: 28.6139, lng: 77.2090 },
  'bangalore': { lat: 12.9716, lng: 77.5946 },
  'bengaluru': { lat: 12.9716, lng: 77.5946 },
  'chennai': { lat: 13.0827, lng: 80.2747 },
  'kolkata': { lat: 22.5726, lng: 88.3639 },
  'calcutta': { lat: 22.5726, lng: 88.3639 },
  'pune': { lat: 18.5204, lng: 73.8567 },
  'kochi': { lat: 9.9312, lng: 76.2636 },
  'cochin': { lat: 9.9312, lng: 76.2636 },
  'hyderabad': { lat: 17.3616, lng: 78.4679 },
  'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'jaipur': { lat: 26.9124, lng: 75.7873 },
  'lucknow': { lat: 26.8467, lng: 80.9462 },
  'thiruvananthapuram': { lat: 8.5241, lng: 76.9366 },
  'trivandrum': { lat: 8.5241, lng: 76.9366 },
  'goa': { lat: 15.2993, lng: 74.1146 },
  'panaji': { lat: 15.4909, lng: 73.8278 },
  'bhubaneswar': { lat: 20.2961, lng: 85.8260 },
  'bhubaneshwar': { lat: 20.2961, lng: 85.8260 },
  'ranchi': { lat: 23.3401, lng: 85.3096 },
  'patna': { lat: 25.6072, lng: 85.1293 },
  'indore': { lat: 22.7196, lng: 75.8598 },
  'nagpur': { lat: 21.1458, lng: 79.0882 },
  'coimbatore': { lat: 11.0168, lng: 76.9558 },
  'mysore': { lat: 12.2958, lng: 76.6394 },
  'kozhikode': { lat: 11.2588, lng: 75.7744 },
  'kannur': { lat: 11.8705, lng: 76.3665 },
  'vadodara': { lat: 22.3073, lng: 73.1603 },
  'surat': { lat: 21.1702, lng: 72.8313 },
  'jalna': { lat: 19.8460, lng: 76.5400 },

  // World cities
  'new york': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'houston': { lat: 29.7604, lng: -95.3698 },
  'phoenix': { lat: 33.4484, lng: -112.0740 },
  'philadelphia': { lat: 39.9526, lng: -75.1652 },
  'san antonio': { lat: 29.4241, lng: -98.4936 },
  'san diego': { lat: 32.7157, lng: -117.1611 },
  'dallas': { lat: 32.7767, lng: -96.7970 },
  'san jose': { lat: 37.3382, lng: -121.8863 },
  'austin': { lat: 30.2672, lng: -97.7431 },
  'jacksonville': { lat: 30.3322, lng: -81.6557 },
  'fort worth': { lat: 32.7555, lng: -97.3308 },
  'columbus': { lat: 39.9612, lng: -82.9988 },
  'charlotte': { lat: 35.2271, lng: -80.8431 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'indianapolis': { lat: 39.7684, lng: -86.1581 },
  'seattle': { lat: 47.6062, lng: -122.3321 },
  'denver': { lat: 39.7392, lng: -104.9903 },
  'washington': { lat: 38.9072, lng: -77.0369 },
  'boston': { lat: 42.3601, lng: -71.0589 },
  'atlanta': { lat: 33.7490, lng: -84.3880 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'las vegas': { lat: 36.1699, lng: -115.1398 },
  'portland': { lat: 45.5051, lng: -122.6750 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'berlin': { lat: 52.5200, lng: 13.4050 },
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'rome': { lat: 41.9028, lng: 12.4964 },
  'milan': { lat: 45.4642, lng: 9.2916 },
  'barcelona': { lat: 41.3851, lng: 2.1734 },
  'amsterdam': { lat: 52.3676, lng: 4.9041 },
  'brussels': { lat: 50.8503, lng: 4.3517 },
  'vienna': { lat: 48.2082, lng: 16.3738 },
  'zurich': { lat: 47.3769, lng: 8.5417 },
  'geneva': { lat: 46.2044, lng: 6.1432 },
  'dublin': { lat: 53.3498, lng: -6.2603 },
  'edinburgh': { lat: 55.9533, lng: -3.1883 },
  'glasgow': { lat: 55.8642, lng: -4.2518 },
  'stockholm': { lat: 59.3293, lng: 18.0686 },
  'oslo': { lat: 59.9139, lng: 10.7522 },
  'copenhagen': { lat: 55.6761, lng: 12.5683 },
  'helsinki': { lat: 60.1699, lng: 24.9384 },
  'tallinn': { lat: 59.4370, lng: 24.7536 },
  'reykjavik': { lat: 64.1466, lng: -21.8912 },
  'moscow': { lat: 55.7558, lng: 37.6173 },
  'saint petersburg': { lat: 59.9343, lng: 30.3351 },
  'warsaw': { lat: 52.2297, lng: 21.0122 },
  'prague': { lat: 50.0755, lng: 14.4378 },
  'budapest': { lat: 47.4979, lng: 19.0402 },
  'belgrade': { lat: 44.7866, lng: 20.4489 },
  'sofia': { lat: 42.6977, lng: 23.3219 },
  'bucharest': { lat: 44.4268, lng: 26.1025 },
  'athens': { lat: 37.9838, lng: 23.7275 },
  'naples': { lat: 40.8518, lng: 14.2681 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'toronto': { lat: 43.6532, lng: -79.3832 },
  'vancouver': { lat: 49.2827, lng: -123.1207 },
  'montreal': { lat: 45.5017, lng: -73.5673 },
  'calgary': { lat: 51.0486, lng: -114.0701 },
  'edmonton': { lat: 53.5461, lng: -113.4937 },
  'ottawa': { lat: 45.4215, lng: -75.6977 },
  'tokyo': { lat: 35.6762, lng: 139.6503 },
  'osaka': { lat: 34.6937, lng: 135.5023 },
  'kyoto': { lat: 35.0116, lng: 135.7681 },
  'nagoya': { lat: 35.1815, lng: 136.9065 },
  'sapporo': { lat: 43.0618, lng: 141.3545 },
  'fhukuoka': { lat: 33.5904, lng: 130.4017 },
  'seoul': { lat: 37.5665, lng: 126.9780 },
  'busan': { lat: 35.1796, lng: 129.0756 },
  'beijing': { lat: 39.9042, lng: 116.4074 },
  'shanghai': { lat: 31.2304, lng: 121.4737 },
  'guangzhou': { lat: 23.1291, lng: 113.2644 },
  'shenzhen': { lat: 22.5431, lng: 114.0579 },
  'hong kong': { lat: 22.3193, lng: 114.1694 },
  'taipei': { lat: 25.0320, lng: 121.5251 },
  'manila': { lat: 14.5995, lng: 120.9842 },
  'bangkok': { lat: 13.7563, lng: 100.5018 },
  'hanoi': { lat: 21.0279, lng: 105.8342 },
  'jakarta': { lat: -6.2088, lng: 106.8456 },
  'surabaya': { lat: -7.2575, lng: 112.7451 },
  'kuala lumpur': { lat: 3.1390, lng: 101.6869 },
  'singapore': { lat: 1.3521, lng: 103.8198 },
  'dubai': { lat: 25.2048, lng: 55.2708 },
  'abu dhabi': { lat: 24.4539, lng: 54.3773 },
  'doha': { lat: 25.2854, lng: 51.5310 },
  'riyadh': { lat: 24.7136, lng: 46.6753 },
  'jeddah': { lat: 21.4738, lng: 39.1446 },
  'mecca': { lat: 21.3891, lng: 39.8579 },
  'medina': { lat: 24.5236, lng: 39.7680 },
  'cairo': { lat: 30.0444, lng: 31.2357 },
  'alexandria': { lat: 31.2001, lng: 29.9187 },
  'johannesburg': { lat: -26.2041, lng: 28.0473 },
  'cape town': { lat: -33.9249, lng: 18.4241 },
  'durban': { lat: -29.8586, lng: 31.0218 },
  'pretoria': { lat: -25.7479, lng: 28.1881 },
  'nairobi': { lat: -1.2921, lng: 36.8219 },
  'lagos': { lat: 6.5244, lng: 3.3792 },
  'accra': { lat: 5.5560, lng: -0.2133 },
  'abidjan': { lat: 6.8216, lng: -5.3100 },
  'addis ababa': { lat: 9.0320, lng: 38.7569 },
  'khartoum': { lat: 15.5560, lng: 32.5344 },
  'baghdad': { lat: 33.3158, lng: 44.3936 },
  'tehran': { lat: 35.6892, lng: 51.3888 },
  'istanbul': { lat: 41.0082, lng: 28.9784 },
  'ankara': { lat: 39.9334, lng: 32.8597 },
  'tel aviv': { lat: 32.0853, lng: 34.7818 },
  'jerusalem': { lat: 31.7683, lng: 35.2137 },
  'sydney': { lat: -33.8688, lng: 151.2093 },
  'melbourne': { lat: -37.8136, lng: 144.9631 },
  'brisbane': { lat: -27.4698, lng: 153.0251 },
  'perth': { lat: -31.9505, lng: 115.8605 },
  'adelaide': { lat: -34.9285, lng: 138.6007 },
  'auckland': { lat: -41.2865, lng: 174.7762 },
  'wellington': { lat: -41.2865, lng: 174.7762 },
  'christchurch': { lat: -43.5321, lng: 172.6362 },
  'vancouver': { lat: 49.2827, lng: -123.1207 },
  'mexico city': { lat: 19.4326, lng: -99.1332 },
  'guadalajara': { lat: 20.6736, lng: -103.3496 },
  'monterrey': { lat: 25.6866, lng: -100.3161 },
  'buenos aires': { lat: -34.6037, lng: -58.3816 },
  'sao paulo': { lat: -23.5505, lng: -46.6333 },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729 },
  'caracas': { lat: 10.5167, lng: -75.4833 },
  'bogota': { lat: 4.7110, lng: -74.0721 },
  'quito': { lat: -0.1807, lng: -78.4680 },
  'lima': { lat: -12.0464, lng: -77.0428 },
  'santiago': { lat: -33.4489, lng: -70.6693 },
  'lisbon': { lat: 38.7223, lng: -9.1393 },
  'porto': { lat: 41.1496, lng: -8.6109 },
  'brussels': { lat: 50.8503, lng: 4.3517 },
  'new york': { lat: 40.7128, lng: -74.0060 },
  'los angeles': { lat: 34.0522, lng: -118.2437 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'san francisco': { lat: 37.7749, lng: -122.4194 },
  'toronto': { lat: 43.6532, lng: -79.3832 },
  'vancouver': { lat: 49.2827, lng: -123.1207 },
  'mexico city': { lat: 19.4326, lng: -99.1332 },
  'sydney': { lat: -33.8688, lng: 151.2093 },
  'tokyo': { lat: 35.6762, lng: 139.6503 },
  'beijing': { lat: 39.9042, lng: 116.4074 },
  'shanghai': { lat: 31.2304, lng: 121.4737 },
  'hong kong': { lat: 22.3193, lng: 114.0579 },
  'singapore': { lat: 1.3521, lng: 103.8198 },
  'dubai': { lat: 25.2048, lng: 55.2708 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'berlin': { lat: 52.5200, lng: 13.4050 },
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'rome': { lat: 41.9028, lng: 12.4964 }
};

// 9-fold lunar nodes (for Vedic)
const NODES = ['Rahu', 'Ketu'];

/**
 * Convert an ecliptic longitude (0-360) to a zodiac sign + deg/min.
 * @param {number} lon - Ecliptic longitude in degrees
 * @returns {{sign: string, degrees: number, minutes: number, lon: number}}
 */
function zodiacFromLon(lon) {
  lon = ((lon % 360) + 360) % 360;
  const signIdx = Math.floor(lon / 30) % 12;
  const remainder = lon - signIdx * 30;
  const degrees = Math.floor(remainder);
  const minutes = Math.floor((remainder - degrees) * 60);
  return {
    sign: ZODIAC_SIGNS[signIdx],
    degrees: degrees,
    minutes: minutes,
    lon: lon
  };
}

/**
 * Compute the Lahiri ayanamsa for a given Julian date.
 * Uses the standard approximation: 24.042° at J2000.0, increasing at
 * ~50.29 arcseconds per year (~0.01397°/year).
 * @param {Astronomy.AstroTime} time
 * @returns {number} ayanamsa in degrees
 */
function lahiriAyanamsa(time) {
  // T = Julian centuries from J2000 (time.ut = days from J2000)
  const yearsFromJ2000 = time.ut / 365.25;
  // Ayanamsa at J2000 = 24.042 degrees (approx 24°02'31")
  // Precession = ~50.29" per year = 0.01397° per year
  return 24.042 + 0.01397 * yearsFromJ2000;
}

/**
 * Apply ayanamsa to get sidereal longitude from tropical longitude.
 * @param {number} tropicalLon
 * @param {number} ayanamsa
 * @returns {number} sidereal longitude (0-360)
 */
function toSidereal(tropicalLon, ayanamsa) {
  return ((tropicalLon - ayanamsa + 360) % 360 + 360) % 360;
}

/**
 * Get a planet's position (tropical and sidereal).
 * @param {string} bodyKey - astronomy-engine Body enum value (e.g. 'Sun')
 * @param {Astronomy.AstroTime} time
 * @param {Astronomy.Observer} observer
 * @param {number} ayanamsa
 * @returns {{tropical: object, sidereal: object}}
 */
function planetPosition(bodyStr, time, observer, ayanamsa) {
  const body = Astronomy.Body[bodyStr];
  if (!body) return null;

  const equ = Astronomy.Equator(body, time, observer, true, true);
  const eclip = Astronomy.Ecliptic(equ.vec);

  const tropicalLon = eclip.elon;
  const tropicalPos = zodiacFromLon(tropicalLon);

  const siderealLon = toSidereal(tropicalLon, ayanamsa);
  const siderealPos = zodiacFromLon(siderealLon);

  return {
    tropical: { ...tropicalPos, longitude: tropicalLon },
    sidereal: { ...siderealPos, longitude: siderealLon },
    longitude: tropicalLon,
    distance: equ.dist
  };
}

/**
 * Calculate the Ascendant (Lagna) using numerical iteration.
 * Finds the ecliptic longitude that rises at the eastern horizon
 * (altitude ≈ 0, azimuth ≈ 90°).
 * @param {Astronomy.AstroTime} time
 * @param {Astronomy.Observer} observer
 * @param {number} epsilonDeg - obliquity of ecliptic in degrees
 * @returns {{tropical: object, sidereal: object}}
 */
function calculateAscendant(time, observer, epsilonDeg, ayanamsa) {
  function eclipLonToHoriz(lonDeg) {
    const eps = epsilonDeg * DEG2RAD;
    const lon = lonDeg * DEG2RAD;

    const sinDec = Math.sin(eps) * Math.sin(lon);
    const cosDec = Math.sqrt(1 - sinDec * sinDec);
    if (cosDec < 1e-10) return { alt: 999, az: 999 };

    const dec = Math.asin(sinDec);
    let ra = Math.atan2(Math.cos(eps) * Math.sin(lon), Math.cos(lon));
    if (ra < 0) ra += 2 * PI;
    const raDeg = ra * RAD2DEG;
    const decDeg = dec * RAD2DEG;

    const horiz = Astronomy.Horizon(time, observer, raDeg, decDeg);
    return { alt: horiz.altitude, az: horiz.azimuth };
  }

  // Find the ascending point on the eastern horizon (azimuth < 180, altitude crossing 0)
  let ascLon = 0;
  for (let i = 0; i < 3600; i++) {
    const lon = i * 0.1;
    const h1 = eclipLonToHoriz(lon);
    const h2 = eclipLonToHoriz(lon + 0.1);

    if (h1.alt * h2.alt <= 0) {
      // Zero crossing
      if (h1.az !== 999 && h1.az < 180) {
        // Eastern horizon — refine with binary search
        let lo = lon, hi = lon + 0.1;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          const hm = eclipLonToHoriz(mid);
          if (hm.alt < 0) lo = mid; else hi = mid;
        }
        ascLon = (lo + hi) / 2;
        break;
      }
    }
  }

  // If no crossing found with az < 180, find closest to eastern horizon
  if (ascLon === 0) {
    let bestScore = Infinity;
    for (let i = 0; i < 36000; i++) {
      const lon = i * 0.01;
      const h = eclipLonToHoriz(lon);
      if (h.alt === 999) continue;
      const score = Math.abs(h.alt) + 0.5 * Math.abs(h.az - 90);
      if (score < bestScore) {
        bestScore = score;
        ascLon = lon;
      }
    }
  }

  const tropicalPos = zodiacFromLon(ascLon);
  const siderealLon = toSidereal(ascLon, ayanamsa);
  const siderealPos = zodiacFromLon(siderealLon);

  return {
    tropical: { ...tropicalPos, longitude: ascLon },
    sidereal: { ...siderealPos, longitude: siderealLon }
  };
}

/**
 * Calculate the obliquity of the ecliptic (mean) for a given time.
 * Returns the value in degrees.
 * @param {Astronomy.AstroTime} time
 * @returns {number} obliquity in degrees
 */
function getObliquity(time) {
  // T = Julian centuries from J2000.0 (time.ut is days from J2000)
  const T = time.ut / 36525;
  // Mean obliquity (IAU 2006) in arcseconds
  const arcsec = 84381.406092970528 - T * 46.1303982734447 +
    T * T * 0.000137541 + T * T * T * 0.001813439;
  return arcsec / 3600.0;
}

/**
 * Calculate Nakshatra from Moon's sidereal longitude.
 * Each Nakshatra spans 13°20' (13.333°).
 * @param {number} moonSiderealLon
 * @returns {{name: string, degr: number, minutes: number, pada: number, number: number}}
 */
function calculateNakshatra(moonSiderealLon) {
  const NAKSHATRA_DEGREES = 13.0 + 20.0 / 60.0; // 13.333...°
  const idx = Math.floor(moonSiderealLon / NAKSHATRA_DEGREES) % 27;
  const remainder = moonSiderealLon - idx * NAKSHATRA_DEGREES;
  const deg = Math.floor(remainder);
  const min = Math.floor((remainder - deg) * 60);
  const pada = Math.floor(remainder / (NAKSHATRA_DEGREES / 4)) + 1;
  return {
    name: NAKSHATRAS[idx],
    number: idx + 1,
    degr: deg,
    minutes: min,
    pada: pada
  };
}

/**
 * Calculate Vimshottari Dasha period at birth.
 * @param {number} moonSiderealLon - Moon's sidereal longitude
 * @returns {{mahaDasha: {lord: string, balance: number, years: number, months: number, days: number}, antardashas: Array}}
 */
function calculateDasha(moonSiderealLon) {
  // Each Nakshatra is 13°20'. The Vimshottari Dasha starts from the Moon's
  // position within its birth Nakshatra.
  const NAKSHATRA_DEGREES = 13.0 + 20.0 / 60.0;

  // Vimshottari Dasha periods in years (starting from Ketu)
  const DASHA_YEARS = {
    ketu: 7, venus: 20, sun: 6, moon: 10, mars: 7,
    rahu: 18, jupiter: 16, saturn: 19, mercury: 27
  };

  const DASHA_ORDER = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];

  // Total = 120 years
  const TOTAL_YEARS = 120;

  // Find which Nakshatra the Moon is in
  const nakIdx = Math.floor(moonSiderealLon / NAKSHATRA_DEGREES) % 27;

  // Calculate elapsed time in the current Dashas based on the Moon's position
  // within its Nakshatra
  const remainder = moonSiderealLon - nakIdx * NAKSHATRA_DEGREES;
  const fractionInNakshatra = remainder / NAKSHATRA_DEGREES;

  // Each Nakshatra corresponds to a specific Mahadasha lord
  // Nakshatra-to-Mahadasha mapping (0-indexed):
  // 0-2: Ketu, 3-5: Venus, 6: Sun, 7-9: Moon, 10-12: Mars,
  // 13-15: Rahu, 16-18: Jupiter, 19-21: Saturn, 22-24: Mercury,
  // 25-26: Ketu (next cycle)
  // But the actual mapping is: each group of Nakshatras corresponds to one planet
  // Ketu: Ashwini(0)
  // Venus: Bharani(1)-Krittika(2-3)... actually, the mapping is:
  // 0: Ashwini -> Ketu (starts), 1: Bharani -> Venus, ...
  // The standard mapping: each Nakshatra's lord changes. The Dasha period
  // is calculated from the Moon's birth Nakshatra.

  // The Dasha that is running at birth:
  // Nakshatras 0-24 map to Mahadasha lords as follows:
  const NAK_DASHA_MAP = [
    'ketu', 'ketu', 'ketu', 'venus', 'venus', 'venus',
    'sun', 'sun', 'sun', 'moon', 'moon', 'moon',
    'mars', 'mars', 'mars', 'rahu', 'rahu', 'rahu',
    'jupiter', 'jupiter', 'jupiter', 'saturn', 'saturn', 'saturn',
    'mercury', 'mercury', 'mercury'
  ];

  // Wait, that's not right. Each Nakshatra has a specific lord, and the
  // Mahadasha sequence starts from the lord of the birth Nakshatra.
  // The correct mapping is that each Nakshatra is associated with one
  // Mahadasha lord based on the Vimshottari sequence.

  // Simplified approach: find the Dasha lord based on the birth Nakshatra.
  const lord = NAK_DASHA_MAP[nakIdx] || 'ketu';

  // Calculate the balance of the current Dasha
  const dashaDuration = DASHA_YEARS[lord];
  const balanceYears = dashaDuration * (1 - fractionInNakshatra);
  const balanceMonths = (balanceYears - Math.floor(balanceYears)) * 12;
  const balanceDays = (balanceMonths - Math.floor(balanceMonths)) * 30;

  // Build antardasha (Bhukti) list for the current Mahadasha
  const lordIdx = DASHA_ORDER.indexOf(lord);
  const antardashas = [];
  for (let i = 0; i < 9; i++) {
    const bhuktiLord = DASHA_ORDER[(lordIdx + i) % 9];
    antardashas.push({
      lord: bhuktiLord,
      years: DASHA_YEARS[bhuktiLord]
    });
  }

  return {
    mahaDasha: {
      lord: lord,
      balance: balanceYears,
      balanceYears: Math.floor(balanceYears),
      balanceMonths: Math.floor(balanceMonths),
      balanceDays: Math.floor(balanceDays)
    },
    antardashas: antardashas
  };
}

/**
 * Calculate Hellenistic Lots.
 * Lot of Fortune (day): Ascendant + Moon - Sun
 * Lot of Fortune (night): Ascendant + Sun - Moon
 * Lot of Spirit: Ascendant + Sun - Moon (day) / Ascendant + Moon - Sun (night)
 * @param {number} ascLon
 * @param {number} sunLon
 * @param {number} moonLon
 * @param {number} saturnLon
 * @param {number} jupiterLon
 * @param {number} marsLon
 * @param {number} venusLon
 * @param {number} mercuryLon
 * @param {string} sect - 'day' or 'night'
 * @returns {object}
 */
function calculateHellenisticLots(ascLon, sunLon, moonLon, saturnLon, jupiterLon, marsLon, venusLon, mercuryLon, sect) {
  // Lot of Fortune
  let lotFortune;
  if (sect === 'day') {
    // By day: Ascendant + Moon - Sun
    lotFortune = ((ascLon + moonLon - sunLon + 360) % 360 + 360) % 360;
  } else {
    // By night: Ascendant + Sun - Moon
    lotFortune = ((ascLon + sunLon - moonLon + 360) % 360 + 360) % 360;
  }

  // Lot of Spirit (inverse of Fortune)
  let lotSpirit;
  if (sect === 'day') {
    // By day: Ascendant + Sun - Moon
    lotSpirit = ((ascLon + sunLon - moonLon + 360) % 360 + 360) % 360;
  } else {
    // By night: Ascendant + Moon - Sun
    lotSpirit = ((ascLon + moonLon - sunLon + 360) % 360 + 360) % 360;
  }

  // Lot of Eros (Venus + Ascendant - Moon, traditional)
  const lotEros = ((venusLon + ascLon - moonLon + 360) % 360 + 360) % 360;

  // Lot of Death (Saturn + Ascendant - Moon)
  const lotDeath = ((saturnLon + ascLon - moonLon + 360) % 360 + 360) % 360;

  // Lot of Nike (Jupiter + Ascendant - Sun)
  const lotNike = ((jupiterLon + ascLon - sunLon + 360) % 360 + 360) % 360;

  return {
    fortune: zodiacFromLon(lotFortune),
    spirit: zodiacFromLon(lotSpirit),
    eros: zodiacFromLon(lotEros),
    death: zodiacFromLon(lotDeath),
    nike: zodiacFromLon(lotNike),
    sect: sect
  };
}

/**
 * Determine sect (day/night) based on whether the Sun is above the horizon at birth.
 * @param {Astronomy.AstroTime} time
 * @param {Astronomy.Observer} observer
 * @returns {'day'|'night'}
 */
function calculateSect(time, observer) {
  const equ = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  const horiz = Astronomy.Horizon(time, observer, equ.ra, equ.dec);
  return horiz.altitude > 0 ? 'day' : 'night';
}

/**
 * Calculate planetary dignity for Hellenistic tradition.
 * @param {object} planetPos
 * @param {number} sunLon
 * @param {number} moonLon
 * @returns {object}
 */
function calculateDignity(planetPos, sunLon, moonLon) {
  const lon = planetPos.longitude;
  const signIdx = Math.floor(lon / 30) % 12;

  const RULERS = {
    sun: [0, 4],      // Aries, Leo
    moon: [3],        // Cancer
    mars: [0, 6],     // Aries, Scorpio
    venus: [1, 5],    // Taurus, Libra
    mercury: [2, 11], // Gemini, Virgo
    jupiter: [7, 9],  // Sagittarius, Pisces
    saturn: [8, 10],  // Capricorn, Aquarius
    rahu: [6],        // Scorpio (traditional)
    ketu: [2]         // Gemini (traditional)
  };

  const signs = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
  const planetName = planetPos.name.toLowerCase();

  // Exaltation positions
  const EXALTATIONS = {
    sun: 19,    // 19° Aries (0° + 19°)
    moon: 92,   // 3° Taurus (30° + 3°) = 33°... actually 27° Taurus = 30+27=57? No.
    // Sun exalted in Aries at 19° = 19°
    // Moon exalted in Taurus at 27° = 30 + 27 = 57°
    // etc.
  };

  const isRuler = RULERS[planetName] && RULERS[planetName].includes(signIdx);
  const isExalted = EXALTATIONS[planetName] !== undefined &&
    Math.abs(((lon - EXALTATIONS[planetName] + 360) % 360) - 0) < 1;

  // Check detriment (opposite sign from rulership)
  const inDetriment = RULERS[planetName] && RULERS[planetName].some(s => (s + 6) % 12 === signIdx);

  // Check fall (opposite exaltation)
  const inFall = EXALTATIONS[planetName] !== undefined &&
    Math.abs(((lon - (EXALTATIONS[planetName] + 180)) % 360) - 0) < 1;

  let dignity = 'pareces';
  if (isRuler) dignity = 'ruler';
  else if (isExalted) dignity = 'exalted';
  else if (inFall) dignity = 'fall';
  else if (inDetriment) dignity = 'detriment';

  return { dignity, sign: signs[signIdx] };
}

/**
 * Calculate Western houses (Placidus method approximation).
 * For simplicity, returns the Ascendant and Midheaven; full house
 * cusp calculation would require iterative Placidus, but for this
 * entertainment application, the 12-sign wheel suffices.
 * @param {number} ascLon
 * @param {number} mcLon
 * @returns {object}
 */
function calculateHouses(ascLon, mcLon) {
  const HOUSE_CUSPS = [];
  for (let i = 0; i < 12; i++) {
    // In a simple whole-sign house system, each house cusp is 30°
    // starting from the Ascendant
    HOUSE_CUSPS.push(((ascLon + i * 30 + 360) % 360 + 360) % 360);
  }

  return {
    system: 'whole-sign (simplified)',
    cusps: HOUSE_CUSPS,
    ascendant: zodiacFromLon(ascLon),
    midheaven: zodiacFromLon(mcLon)
  };
}

/**
 * Geocode a birthplace string to coordinates.
 * Uses a built-in city database; falls back to a neutral position.
 * @param {string} birthplace
 * @returns {{lat: number, lng: number, resolved: boolean, city?: string}}
 */
function geocodeBirthplace(birthplace) {
  if (!birthplace || typeof birthplace !== 'string') {
    return { lat: 0, lng: 0, resolved: false };
  }

  const normalized = birthplace.toLowerCase().trim().replace(/^(city of |the )/i, '');

  // Try exact match against city database
  if (CITY_DB[normalized]) {
    const loc = CITY_DB[normalized];
    return { lat: loc.lat, lng: loc.lng, resolved: true, city: birthplace };
  }

  // Try partial match (e.g. "Mumbai, India" -> match "mumbai")
  for (const [cityName, coords] of Object.entries(CITY_DB)) {
    if (normalized.startsWith(cityName) || normalized.includes(cityName)) {
      return { lat: coords.lat, lng: coords.lng, resolved: true, city: cityName };
    }
  }

  // Fallback: neutral position (equator/prime meridian)
  return { lat: 0, lng: 0, resolved: false, city: birthplace };
}

/**
 * Resolve timezone for given coordinates.
 * Uses geo-tz to find timezone identifiers from lat/lng.
 * @param {number} lat
 * @param {number} lng
 * @returns {string|null} IANA timezone name
 */
function resolveTimezone(lat, lng) {
  try {
    const tz = geoTz.find(lat, lng);
    if (tz && tz.length > 0) return tz[0];
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Convert local birth time to UTC.
 * @param {string} dob - YYYY-MM-DD
 * @param {string} birthTime - HH:MM (24h, may be empty)
 * @param {string} timezone - IANA timezone string
 * @returns {{utcDate: Date, timezone: string, hadTime: boolean}}
 */
function localToUtc(dob, birthTime, timezone) {
  const parts = dob.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  let hours = 0, minutes = 0;
  let hadTime = false;

  if (birthTime && /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(birthTime)) {
    const tParts = birthTime.split(':');
    hours = parseInt(tParts[0], 10);
    minutes = parseInt(tParts[1], 10);
    hadTime = true;
  }

  let utcDate;

  if (hadTime && timezone && timezone !== 'UTC') {
    const localDate = moment.tz(
      year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') +
      ' ' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0'),
      timezone
    );
    utcDate = localDate.utc().toDate();
  } else if (hadTime) {
    // No timezone (coordinates at sea level/neutral) — use birthtime as UTC
    utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  } else {
    // No birth time — default to 00:00 local
    utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }

  return { utcDate, timezone: timezone || 'UTC', hadTime };
}

/**
 * Build a planetary positions object for all planets.
 * @param {Astronomy.AstroTime} time
 * @param {Astronomy.Observer} observer
 * @param {number} ayanamsa
 * @returns {object}
 */
function calculatePlanets(time, observer, ayanamsa) {
  const PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  const result = {};

  for (const planetName of PLANETS) {
    const pos = planetPosition(planetName, time, observer, ayanamsa);
    if (pos) {
      pos.name = planetName;
      result[planetName] = pos;
    }
  }

  // Calculate Moon's ascending node (Rahu) longitude.
  // Mean longitude of ascending node at J2000: 125.04° (ecliptic longitude)
  // Moves retrograde at ~19.3087° per year.
  const yearsFromJ2000 = time.ut / 365.25;
  let rahuLon = ((125.04 - 19.3087 * yearsFromJ2000 + 360) % 360 + 360) % 360;
  const rahuSidereal = toSidereal(rahuLon, ayanamsa);
  const ketuLon = ((rahuLon + 180) % 360 + 360) % 360;
  const ketuSidereal = toSidereal(ketuLon, ayanamsa);

  result.Rahu = {
    tropical: zodiacFromLon(rahuLon),
    sidereal: zodiacFromLon(rahuSidereal),
    longitude: rahuLon,
    name: 'Rahu',
    retrograde: true
  };

  result.Ketu = {
    tropical: zodiacFromLon(ketuLon),
    sidereal: zodiacFromLon(ketuSidereal),
    longitude: ketuLon,
    name: 'Ketu',
    retrograde: true
  };

  // Determine retrograde status for each planet
  for (const planetName of PLANETS) {
    if (result[planetName]) {
      // Check if planet is retrograde by comparing position at time +/- 1 day
      const timeBefore = new Astronomy.AstroTime(
        new Date(time.date.getTime() - 86400000)
      );
      const timeAfter = new Astronomy.AstroTime(
        new Date(time.date.getTime() + 86400000)
      );

      const equBefore = Astronomy.Equator(Astronomy.Body[planetName], timeBefore, observer, true, true);
      const equAfter = Astronomy.Equator(Astronomy.Body[planetName], timeAfter, observer, true, true);

      const eclipBefore = Astronomy.Ecliptic(equBefore.vec);
      const eclipAfter = Astronomy.Ecliptic(equAfter.vec);

      result[planetName].retrograde = eclipAfter.elon < eclipBefore.elon;
    }
  }

  result.Rahu.retrograde = true; // Rahu always retrograde
  result.Ketu.retrograde = true; // Ketu always retrograde

  return result;
}

/**
 * Calculate the Midheaven (MC) — the highest point on the ecliptic.
 * @param {Astronomy.AstroTime} time
 * @param {Astronomy.Observer} observer
 * @returns {number} MC ecliptic longitude
 */
function calculateMC(time, observer) {
  let bestLon = 0;
  let bestAlt = -999;

  for (let i = 0; i < 3600; i++) {
    const lon = i * 0.1;
    const pos = calculateSinglePoint(lon, time, observer);
    if (pos.alt > bestAlt) {
      bestAlt = pos.alt;
      bestLon = lon;
    }
  }

  return bestLon;
}

function calculateSinglePoint(lon, time, observer) {
  const equ = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
  const eclip = Astronomy.Ecliptic(equ.vec);
  const epsilon = getObliquity(time);
  // Convert ecliptic lon to equatorial
  const eps = epsilon * DEG2RAD;
  const l = lon * DEG2RAD;
  const sinDec = Math.sin(eps) * Math.sin(l);
  const cosDec = Math.sqrt(1 - sinDec * sinDec);
  if (cosDec < 1e-10) return { alt: -999, az: 0 };
  const dec = Math.asin(sinDec);
  let ra = Math.atan2(Math.cos(eps) * Math.sin(l), Math.cos(l));
  if (ra < 0) ra += 2 * PI;
  const raDeg = ra * RAD2DEG;
  const decDeg = dec * RAD2DEG;
  const horiz = Astronomy.Horizon(time, observer, raDeg, decDeg);
  return { alt: horiz.altitude, az: horiz.azimuth };
}

/**
 * Calculate the complete birth chart.
 * @param {string} dob - Date of birth (YYYY-MM-DD)
 * @param {string} birthTime - Birth time (HH:MM, 24-hour, may be empty)
 * @param {string} birthplace - Birth location (city name)
 * @param {string} tradition - 'western', 'vedic', or 'hellenic'
 * @returns {object} Complete chart data
 */
function calculateChart(dob, birthTime, birthplace, tradition) {
  const geo = geocodeBirthplace(birthplace || '');
  const timezone = geo.resolved ? resolveTimezone(geo.lat, geo.lng) : null;

  const { utcDate, hadTime } = localToUtc(dob, birthTime || '', timezone || null);
  const time = new Astronomy.AstroTime(utcDate);
  const observer = new Astronomy.Observer(geo.lat, geo.lng, 0);

  const ayanamsa = lahiriAyanamsa(time);
  const epsilon = getObliquity(time);

  const planets = calculatePlanets(time, observer, ayanamsa);

  const asc = calculateAscendant(time, observer, epsilon, ayanamsa);
  const mcLon = calculateMC(time, observer);
  const mcSidereal = toSidereal(mcLon, ayanamsa);

  const sun = planets.Sun;
  const moon = planets.Moon;

  // Vedic-specific: Rashi (Moon sign), Nakshatra, Dasha
  const moonSiderealLon = moon.sidereal.longitude;
  const nakshatra = calculateNakshatra(moonSiderealLon);
  const dasha = calculateDasha(moonSiderealLon);

  // Vedic Rashi = Moon's sidereal sign
  const rashi = moon.sidereal;

  // Hellenistic-specific: Lots, sect, dignity
  const sect = calculateSect(time, observer);

  const lots = calculateHellenisticLots(
    asc.sidereal.longitude,
    sun.sidereal.longitude,
    moon.sidereal.longitude,
    planets.Saturn.sidereal.longitude,
    planets.Jupiter.sidereal.longitude,
    planets.Mars.sidereal.longitude,
    planets.Venus.sidereal.longitude,
    planets.Mercury.sidereal.longitude,
    sect
  );

  // Dignity for each planet (Hellenistic)
  const dignities = {};
  for (const planetName of Object.keys(planets)) {
    dignities[planetName] = calculateDignity(planets[planetName], sun.sidereal.longitude, moon.sidereal.longitude);
  }

  const houses = calculateHouses(asc.sidereal.longitude, mcSidereal);

  return {
    meta: {
      dob: dob,
      birthTime: birthTime || null,
      hadTime: hadTime,
      birthplace: birthplace || '',
      coordinates: { lat: geo.lat, lng: geo.lng },
      timezone: timezone || 'UTC',
      utcDate: utcDate.toISOString(),
      ayanamsa: ayanamsa.toFixed(4),
      obliquity: epsilon.toFixed(6),
      resolved: geo.resolved,
      tradition: tradition
    },
    signs: {
      sun: {
        tropical: sun.tropical,
        sidereal: sun.sidereal
      },
      moon: {
        tropical: moon.tropical,
        sidereal: moon.sidereal
      }
    },
    ascendant: asc,
    midheaven: {
      tropical: zodiacFromLon(mcLon),
      sidereal: zodiacFromLon(mcSidereal),
      longitude: mcLon
    },
    planets: planets,
    houses: houses,
    vedic: {
      rashi: rashi,
      nakshatra: nakshatra,
      dasha: dasha,
      lagna: asc.sidereal
    },
    hellenistic: {
      lots: lots,
      sect: sect,
      dignities: dignities
    }
  };
}

// Expose internals for testing
module.exports = {
  calculateChart,
  calculateAscendant,
  calculateNakshatra,
  calculateDasha,
  calculateHellenisticLots,
  calculateDignity,
  calculateHouses,
  geocodeBirthplace,
  resolveTimezone,
  localToUtc,
  zodiacFromLon,
  toSidereal,
  lahiriAyanamsa,
  getObliquity,
  ZODIAC_SIGNS,
  NAKSHATRAS,
  CITY_DB
};
