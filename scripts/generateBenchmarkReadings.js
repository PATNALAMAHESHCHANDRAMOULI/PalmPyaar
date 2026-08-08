/**
 * PalmPyaar Benchmark Phase 2 — Reading Generator
 * 
 * Generates readings for all benchmark personas using the EXISTING production pipeline.
 * Uses groqProvider.generateReading() exactly as the website does.
 * 
 * NO duplicated logic. NO prompt changes. NO AI changes. NO pipeline changes.
 * ONLY benchmarking.
 * 
 * Input:  benchmark/personas.json
 * Output: benchmark/readings.json
 */

const fs = require('fs');
const path = require('path');
const groqProvider = require('../providers/groqProvider');

// ==========================================
// CONFIGURATION
// ==========================================

const INPUT_FILE = path.join(__dirname, '..', 'benchmark', 'personas.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'benchmark', 'readings.json');
const PROGRESS_INTERVAL = 10;

// ==========================================
// MAIN FUNCTION
// ==========================================

async function main() {
  console.log('PalmPyaar Benchmark Phase 2 — Reading Generator');
  console.log('================================================\n');

  // Load personas
  let personas;
  try {
    const data = fs.readFileSync(INPUT_FILE, 'utf8');
    personas = JSON.parse(data);
    console.log(`Loaded ${personas.length} personas from ${INPUT_FILE}\n`);
  } catch (err) {
    console.error(`Failed to load personas: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(personas) || personas.length === 0) {
    console.error('No personas found in input file');
    process.exit(1);
  }

  // Results array
  const results = [];
  let successCount = 0;
  let failureCount = 0;
  const durations = [];

  const startTime = Date.now();

  // Process each persona
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i];
    const personaStartTime = Date.now();

    try {
      // Call the EXISTING production pipeline
      const reading = await groqProvider.generateReading(persona);

      const durationMs = Date.now() - personaStartTime;
      durations.push(durationMs);

      results.push({
        persona,
        reading: {
          core: reading.core || '',
          love: reading.love || '',
          pro: reading.pro || ''
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          durationMs,
          provider: 'groq'
        }
      });

      successCount++;

    } catch (err) {
      const durationMs = Date.now() - personaStartTime;
      durations.push(durationMs);

      results.push({
        persona,
        reading: {
          core: '',
          love: '',
          pro: ''
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          durationMs,
          provider: 'groq',
          error: err.message || 'Unknown error'
        }
      });

      failureCount++;
      console.warn(`[${i + 1}/${personas.length}] FAILED: ${persona.id} - ${err.message}`);
    }

    // Progress reporting every 10 generations
    const completed = i + 1;
    if (completed % PROGRESS_INTERVAL === 0 || completed === personas.length) {
      const elapsedMs = Date.now() - startTime;
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const remaining = personas.length - completed;
      const estimatedRemainingMs = remaining * avgDuration;
      const estimatedRemainingMin = (estimatedRemainingMs / 60000).toFixed(1);

      console.log(
        `[${completed}/${personas.length}] ` +
        `Success: ${successCount} | Failed: ${failureCount} | ` +
        `Avg: ${avgDuration.toFixed(0)}ms | ` +
        `Elapsed: ${(elapsedMs / 60000).toFixed(1)}min | ` +
        `ETA: ${estimatedRemainingMin}min`
      );
    }
  }

  // Write results
  try {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results saved to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error(`\n❌ Failed to write results: ${err.message}`);
    process.exit(1);
  }

  // Final summary
  const totalDuration = Date.now() - startTime;
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  console.log('\n=== BENCHMARK COMPLETE ===');
  console.log(`Total personas:     ${personas.length}`);
  console.log(`Successful:         ${successCount}`);
  console.log(`Failed:             ${failureCount}`);
  console.log(`Success rate:       ${((successCount / personas.length) * 100).toFixed(1)}%`);
  console.log(`Average duration:   ${avgDuration.toFixed(0)}ms`);
  console.log(`Total time:         ${(totalDuration / 60000).toFixed(1)}min`);
  console.log(`Output file:        ${OUTPUT_FILE}`);
}

// Run
if (require.main === module) {
  main().catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}

module.exports = { main };