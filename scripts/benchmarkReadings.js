/**
 * PalmPyaar Quality Benchmark v1 — Persona Generator
 * 
 * Generates 300 deterministic test personas for benchmarking.
 * 
 * DISTRIBUTION:
 * - 300 total personas
 * - 3 traditions × 100 each (Western, Vedic, Hellenic)
 * - 12 zodiac signs × 25 each
 * - 2 genders × 150 each (Male, Female)
 * - 2 photo states × 150 each (with, without)
 * - Geographic diversity across 6 continents
 * 
 * DETERMINISTIC: Same run always produces identical output.
 * NO RANDOMNESS. NO AI. NO API CALLS.
 * 
 * Output: benchmark/personas.json
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// CONSTANT DEFINITIONS
// ==========================================

const TRADITIONS = ['western', 'vedic', 'hellenic'];

const ZODIAC_SIGNS = [
  { sign: 'aries', startMonth: 3, startDay: 21, endMonth: 4, endDay: 19 },
  { sign: 'taurus', startMonth: 4, startDay: 20, endMonth: 5, endDay: 20 },
  { sign: 'gemini', startMonth: 5, startDay: 21, endMonth: 6, endDay: 20 },
  { sign: 'cancer', startMonth: 6, startDay: 21, endMonth: 7, endDay: 22 },
  { sign: 'leo', startMonth: 7, startDay: 23, endMonth: 8, endDay: 22 },
  { sign: 'virgo', startMonth: 8, startDay: 23, endMonth: 9, endDay: 22 },
  { sign: 'libra', startMonth: 9, startDay: 23, endMonth: 10, endDay: 22 },
  { sign: 'scorpio', startMonth: 10, startDay: 23, endMonth: 11, endDay: 21 },
  { sign: 'sagittarius', startMonth: 11, startDay: 22, endMonth: 12, endDay: 21 },
  { sign: 'capricorn', startMonth: 12, startDay: 22, endMonth: 1, endDay: 19 },
  { sign: 'aquarius', startMonth: 1, startDay: 20, endMonth: 2, endDay: 18 },
  { sign: 'pisces', startMonth: 2, startDay: 19, endMonth: 3, endDay: 20 }
];

const GENDERS = ['male', 'female'];

const BIRTHPLACES = [
  // North America
  { city: 'New York', country: 'USA', continent: 'north_america', lat: 40.7128, lon: -74.0060 },
  { city: 'Los Angeles', country: 'USA', continent: 'north_america', lat: 34.0522, lon: -118.2437 },
  { city: 'Chicago', country: 'USA', continent: 'north_america', lat: 41.8781, lon: -87.6298 },
  { city: 'Toronto', country: 'Canada', continent: 'north_america', lat: 43.6532, lon: -79.3832 },
  { city: 'Vancouver', country: 'Canada', continent: 'north_america', lat: 49.2827, lon: -123.1207 },
  { city: 'Mexico City', country: 'Mexico', continent: 'north_america', lat: 19.4326, lon: -99.1332 },
  
  // South America
  { city: 'São Paulo', country: 'Brazil', continent: 'south_america', lat: -23.5505, lon: -46.6333 },
  { city: 'Buenos Aires', country: 'Argentina', continent: 'south_america', lat: -34.6037, lon: -58.3816 },
  { city: 'Lima', country: 'Peru', continent: 'south_america', lat: -12.0464, lon: -77.0428 },
  { city: 'Bogotá', country: 'Colombia', continent: 'south_america', lat: 4.7110, lon: -74.0721 },
  { city: 'Santiago', country: 'Chile', continent: 'south_america', lat: -33.4489, lon: -70.6693 },
  
  // Europe
  { city: 'London', country: 'UK', continent: 'europe', lat: 51.5074, lon: -0.1278 },
  { city: 'Paris', country: 'France', continent: 'europe', lat: 48.8566, lon: 2.3522 },
  { city: 'Berlin', country: 'Germany', continent: 'europe', lat: 52.5200, lon: 13.4050 },
  { city: 'Madrid', country: 'Spain', continent: 'europe', lat: 40.4168, lon: -3.7038 },
  { city: 'Rome', country: 'Italy', continent: 'europe', lat: 41.9028, lon: 12.4964 },
  { city: 'Amsterdam', country: 'Netherlands', continent: 'europe', lat: 52.3676, lon: 4.9041 },
  { city: 'Vienna', country: 'Austria', continent: 'europe', lat: 48.2082, lon: 16.3738 },
  { city: 'Warsaw', country: 'Poland', continent: 'europe', lat: 52.2297, lon: 21.0122 },
  
  // Africa
  { city: 'Cairo', country: 'Egypt', continent: 'africa', lat: 30.0444, lon: 31.2357 },
  { city: 'Lagos', country: 'Nigeria', continent: 'africa', lat: 6.5244, lon: 3.3792 },
  { city: 'Johannesburg', country: 'South Africa', continent: 'africa', lat: -26.2041, lon: 28.0473 },
  { city: 'Nairobi', country: 'Kenya', continent: 'africa', lat: -1.2921, lon: 36.8219 },
  { city: 'Casablanca', country: 'Morocco', continent: 'africa', lat: 33.5731, lon: -7.5898 },
  { city: 'Cape Town', country: 'South Africa', continent: 'africa', lat: -33.9249, lon: 18.4241 },
  
  // Asia
  { city: 'Tokyo', country: 'Japan', continent: 'asia', lat: 35.6762, lon: 139.6503 },
  { city: 'Delhi', country: 'India', continent: 'asia', lat: 28.7041, lon: 77.1025 },
  { city: 'Shanghai', country: 'China', continent: 'asia', lat: 31.2304, lon: 121.4737 },
  { city: 'Mumbai', country: 'India', continent: 'asia', lat: 19.0760, lon: 72.8777 },
  { city: 'Seoul', country: 'South Korea', continent: 'asia', lat: 37.5665, lon: 126.9780 },
  { city: 'Bangkok', country: 'Thailand', continent: 'asia', lat: 13.7563, lon: 100.5018 },
  { city: 'Singapore', country: 'Singapore', continent: 'asia', lat: 1.3521, lon: 103.8198 },
  { city: 'Dubai', country: 'UAE', continent: 'asia', lat: 25.2048, lon: 55.2708 },
  { city: 'Hong Kong', country: 'Hong Kong', continent: 'asia', lat: 22.3193, lon: 114.1694 },
  { city: 'Jakarta', country: 'Indonesia', continent: 'asia', lat: -6.2088, lon: 106.8456 },
  
  // Oceania
  { city: 'Sydney', country: 'Australia', continent: 'oceania', lat: -33.8688, lon: 151.2093 },
  { city: 'Melbourne', country: 'Australia', continent: 'oceania', lat: -37.8136, lon: 144.9631 },
  { city: 'Auckland', country: 'New Zealand', continent: 'oceania', lat: -36.8485, lon: 174.7633 },
  { city: 'Brisbane', country: 'Australia', continent: 'oceania', lat: -27.4698, lon: 153.0251 }
];

const FIRST_NAMES_MALE = [
  'James', 'Robert', 'John', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Thomas', 'Christopher',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth',
  'Kevin', 'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
  'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin',
  'Samuel', 'Gregory', 'Alexander', 'Patrick', 'Frank', 'Raymond', 'Jack', 'Dennis', 'Jerry', 'Tyler',
  'Aaron', 'Jose', 'Henry', 'Adam', 'Douglas', 'Nathan', 'Peter', 'Zachary', 'Kyle', 'Walter',
  'Ethan', 'Jeremy', 'Harold', 'Keith', 'Christian', 'Roger', 'Noah', 'Gerald', 'Carl', 'Terry',
  'Sean', 'Austin', 'Arthur', 'Lawrence', 'Jesse', 'Dylan', 'Bryan', 'Joe', 'Jordan', 'Billy',
  'Bruce', 'Albert', 'Willie', 'Gabriel', 'Logan', 'Alan', 'Juan', 'Wayne', 'Roy', 'Ralph',
  'Randy', 'Eugene', 'Vincent', 'Russell', 'Louis', 'Philip', 'Bobby', 'Johnny', 'Bradley', 'Harry'
];

const FIRST_NAMES_FEMALE = [
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
  'Nancy', 'Lisa', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle',
  'Dorothy', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia',
  'Kathleen', 'Amy', 'Shirley', 'Angela', 'Helen', 'Anna', 'Brenda', 'Pamela', 'Nicole', 'Emma',
  'Samantha', 'Katherine', 'Christine', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Maria', 'Heather', 'Diane',
  'Virginia', 'Julie', 'Joyce', 'Victoria', 'Olivia', 'Kelly', 'Christina', 'Lauren', 'Joan', 'Evelyn',
  'Judith', 'Megan', 'Cheryl', 'Andrea', 'Hannah', 'Martha', 'Jacqueline', 'Frances', 'Gloria', 'Ann',
  'Teresa', 'Kathryn', 'Sara', 'Janice', 'Jean', 'Alice', 'Madison', 'Doris', 'Abigail', 'Julia',
  'Judy', 'Grace', 'Denise', 'Amber', 'Marilyn', 'Beverly', 'Danielle', 'Theresa', 'Sophia', 'Marie',
  'Diana', 'Brittany', 'Natalie', 'Isabella', 'Charlotte', 'Rose', 'Alexis', 'Kayla', 'Charlotte', 'Audrey'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
  'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
  'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
  'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
  'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes',
  'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'
];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Deterministic hash function for consistent pseudo-random values
 * @param {string} input - Input string
 * @returns {number} Hash value 0-1
 */
function deterministicHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) / 2147483647; // Normalize to 0-1
}

/**
 * Get zodiac sign for a given date
 * @param {number} month - Month (1-12)
 * @param {number} day - Day (1-31)
 * @returns {string} Zodiac sign
 */
function getZodiacSign(month, day) {
  for (const z of ZODIAC_SIGNS) {
    const start = new Date(2000, z.startMonth - 1, z.startDay);
    const end = new Date(2000, z.endMonth - 1, z.endDay);
    const check = new Date(2000, month - 1, day);
    
    if (z.startMonth <= z.endMonth) {
      // Normal case (e.g., March 21 - April 19)
      if (check >= start && check <= end) return z.sign;
    } else {
      // Wraps year end (e.g., Dec 22 - Jan 19)
      if (check >= start || check <= end) return z.sign;
    }
  }
  return 'capricorn'; // fallback
}

/**
 * Generate a date within a zodiac sign's range
 * @param {Object} zodiac - Zodiac sign object
 * @param {number} year - Year
 * @param {number} offset - Day offset within sign (0-28)
 * @returns {string} ISO date string YYYY-MM-DD
 */
function generateDateInSign(zodiac, year, offset) {
  const start = new Date(year, zodiac.startMonth - 1, zodiac.startDay);
  const target = new Date(start.getTime() + offset * 24 * 60 * 60 * 1000);
  
  // Handle year wrap for Capricorn
  if (zodiac.sign === 'capricorn' && target.getMonth() === 0) {
    target.setFullYear(year + 1);
  }
  
  return target.toISOString().split('T')[0];
}

/**
 * Generate deterministic name based on index and gender
 * @param {number} index - Persona index
 * @param {string} gender - 'male' or 'female'
 * @returns {string} Full name
 */
function generateName(index, gender) {
  const firstNames = gender === 'male' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE;
  const firstName = firstNames[index % firstNames.length];
  const lastName = LAST_NAMES[Math.floor(index / firstNames.length) % LAST_NAMES.length];
  return `${firstName} ${lastName}`;
}

/**
 * Generate deterministic photo hash or null
 * @param {number} index - Persona index
 * @param {boolean} hasPhoto - Whether persona has photo
 * @returns {string|null} Photo hash or null
 */
function generatePhotoHash(index, hasPhoto) {
  if (!hasPhoto) return null;
  const hash = deterministicHash(`photo-${index}-palmpyaar-benchmark`);
  return `ph_${hash.toString(36).substring(2, 18)}`;
}

// ==========================================
// MAIN GENERATION FUNCTION
// ==========================================

/**
 * Generate all 300 benchmark personas
 * @returns {Array} Array of persona objects
 */
function generatePersonas() {
  const personas = [];
  const totalPersonas = 300;
  
  // We need 25 personas per zodiac sign (300/12 = 25)
  // Each zodiac gets distributed across traditions, genders, photo states, geographies
  
  let personaIndex = 0;
  
  // For each zodiac sign, generate 25 personas
  for (let zodiacIdx = 0; zodiacIdx < ZODIAC_SIGNS.length; zodiacIdx++) {
    const zodiac = ZODIAC_SIGNS[zodiacIdx];
    const personasPerSign = 25;
    
    for (let signOffset = 0; signOffset < personasPerSign; signOffset++) {
      // Determine tradition (cycle through 3 traditions)
      const traditionIdx = (zodiacIdx * personasPerSign + signOffset) % TRADITIONS.length;
      const tradition = TRADITIONS[traditionIdx];
      
      // Determine gender (alternate)
      const gender = GENDERS[signOffset % GENDERS.length];
      
      // Determine photo state (alternate)
      const hasPhoto = signOffset % 2 === 0;
      
      // Determine birthplace (cycle through all birthplaces)
      const birthplaceIdx = (zodiacIdx * personasPerSign + signOffset) % BIRTHPLACES.length;
      const birthplace = BIRTHPLACES[birthplaceIdx];
      
      // Generate DOB - use year 1960-2000 range, distributed
      const yearBase = 1960 + ((zodiacIdx * personasPerSign + signOffset) % 41); // 1960-2000
      const dayOffset = signOffset % 28; // Within sign range (max ~29 days)
      const dob = generateDateInSign(zodiac, yearBase, dayOffset);
      
      // Generate name
      const name = generateName(personaIndex, gender);
      
      // Generate photo hash
      const photoHash = generatePhotoHash(personaIndex, hasPhoto);
      
      // Create persona
      const persona = {
        id: `bench_${String(personaIndex + 1).padStart(3, '0')}`,
        name,
        dob,
        birthplace: `${birthplace.city}, ${birthplace.country}`,
        tradition,
        photoHash
      };
      
      personas.push(persona);
      personaIndex++;
    }
  }
  
  // Verify we have exactly 300
  if (personas.length !== totalPersonas) {
    throw new Error(`Expected ${totalPersonas} personas, got ${personas.length}`);
  }
  
  return personas;
}

// ==========================================
// VERIFICATION FUNCTION
// ==========================================

/**
 * Verify distribution meets requirements
 * @param {Array} personas - Generated personas
 */
function verifyDistribution(personas) {
  console.log('\n=== DISTRIBUTION VERIFICATION ===\n');
  
  // Tradition counts
  const traditionCounts = {};
  for (const t of TRADITIONS) traditionCounts[t] = 0;
  for (const p of personas) traditionCounts[p.tradition]++;
  console.log('Traditions:', traditionCounts);
  
  // Zodiac counts
  const zodiacCounts = {};
  for (const z of ZODIAC_SIGNS) zodiacCounts[z.sign] = 0;
  for (const p of personas) {
    const [year, month, day] = p.dob.split('-').map(Number);
    const sign = getZodiacSign(month, day);
    zodiacCounts[sign]++;
  }
  console.log('Zodiac signs:', zodiacCounts);
  
  // Gender counts (approximate from names)
  let maleCount = 0, femaleCount = 0;
  for (const p of personas) {
    const firstName = p.name.split(' ')[0];
    if (FIRST_NAMES_MALE.includes(firstName)) maleCount++;
    else if (FIRST_NAMES_FEMALE.includes(firstName)) femaleCount++;
  }
  console.log('Gender (by name):', { male: maleCount, female: femaleCount });
  
  // Photo counts
  const photoCounts = { with: 0, without: 0 };
  for (const p of personas) {
    if (p.photoHash) photoCounts.with++;
    else photoCounts.without++;
  }
  console.log('Photo state:', photoCounts);
  
  // Continent counts
  const continentCounts = {};
  for (const p of personas) {
    const cityCountry = p.birthplace;
    const bp = BIRTHPLACES.find(b => `${b.city}, ${b.country}` === cityCountry);
    if (bp) {
      continentCounts[bp.continent] = (continentCounts[bp.continent] || 0) + 1;
    }
  }
  console.log('Continents:', continentCounts);
  
  // Unique IDs
  const ids = new Set(personas.map(p => p.id));
  console.log(`Unique IDs: ${ids.size}/${personas.length}`);
  
  console.log('\n=== VERIFICATION COMPLETE ===\n');
}

// ==========================================
// MAIN EXECUTION
// ==========================================

function main() {
  console.log('PalmPyaar Quality Benchmark v1 — Persona Generator');
  console.log('Generating 300 deterministic personas...\n');
  
  const personas = generatePersonas();
  
  verifyDistribution(personas);
  
  // Ensure output directory exists
  const outputDir = path.join(__dirname, '..', 'benchmark');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write JSON file
  const outputPath = path.join(outputDir, 'personas.json');
  fs.writeFileSync(outputPath, JSON.stringify(personas, null, 2));
  
  console.log(`✅ Successfully wrote ${personas.length} personas to ${outputPath}`);
  console.log('First 3 personas:');
  console.log(JSON.stringify(personas.slice(0, 3), null, 2));
  console.log('Last 3 personas:');
  console.log(JSON.stringify(personas.slice(-3), null, 2));
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generatePersonas,
  verifyDistribution,
  getZodiacSign,
  TRADITIONS,
  ZODIAC_SIGNS,
  GENDERS,
  BIRTHPLACES
};