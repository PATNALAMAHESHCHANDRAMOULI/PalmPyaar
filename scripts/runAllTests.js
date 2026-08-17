/*
 * Runs the complete PalmPyaar regression suite. Keep this list explicit so a
 * newly added focused test cannot accidentally replace older production gates.
 */
'use strict';

const { spawnSync } = require('child_process');

const suites = [
  'scripts/verifyPhase6.js',
  'scripts/verifyProductionChecks.js',
  'scripts/verifyProductionPath.js',
  'scripts/verifyRazorpaySecurity.js',
  'scripts/verifyAiProviderPath.js',
  'scripts/verifyPalmValidation.js',
  'scripts/verifyUpiPaymentFlow.js',
  'scripts/verifyCustomerJourney.js',
  'scripts/testPipelineIntegration.js',
  'scripts/testPalmEvidenceIntegrity.js',
  'scripts/testOpeningLibrary.js',
  'scripts/testQuestionFlow.js'
];

let failed = 0;

for (const suite of suites) {
  console.log('\n============================================================');
  console.log('Running ' + suite);
  console.log('============================================================');

  const result = spawnSync(process.execPath, [suite], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env }
  });

  if (result.status !== 0) {
    failed++;
    console.error('FAILED: ' + suite + ' exited with ' + result.status);
  } else {
    console.log('PASSED: ' + suite);
  }
}

console.log('\n============================================================');
console.log('COMPLETE REGRESSION SUMMARY');
console.log('Suites passed: ' + (suites.length - failed));
console.log('Suites failed: ' + failed);
console.log('Suites total:  ' + suites.length);
console.log('============================================================');

if (failed > 0) {
  process.exit(1);
}
