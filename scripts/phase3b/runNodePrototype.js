/**
 * PalmPyaar Phase 3B — Node.js Prototype Runner
 *
 * Runs the classical CV pipeline on a provided image or generates
 * a synthetic smoke-test pattern when no image is available.
 *
 * Usage:
 *   node scripts/phase3b/runNodePrototype.js [imagePath]
 *
 * If no imagePath is provided, a synthetic test pattern is used.
 * The synthetic pattern is NOT a real palm photo and is used ONLY
 * to verify that the pipeline code executes without errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage: loadCanvasImage } = require('canvas');

const {
  toGrayscale,
  runPipeline,
  runParameterSweep
} = require('./prototypePalmLines');

/**
 * Generate a synthetic test pattern with line-like structures.
 * This is NOT a palm photo. It exists only to verify pipeline execution.
 */
function generateSyntheticPattern(width = 200, height = 200) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#E8C4A0';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#8B6914';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const startX = cx - 30 + i * 15;
    const startY = cy - 40 + i * 10;
    const endX = cx + 20 - i * 10;
    const endY = cy + 30 - i * 15;
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + 10, startY + 20,
      endX - 10, endY - 20,
      endX, endY
    );
    ctx.stroke();
  }

  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    const x = 20 + i * 22;
    ctx.moveTo(x, 20);
    ctx.lineTo(x + 10, 80);
    ctx.stroke();
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  return imageData;
}

/**
 * Load an image from file path and return ImageData.
 */
async function loadImageFromPath(imagePath) {
  const resolved = path.resolve(imagePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }
  const image = await loadCanvasImage(resolved);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

/**
 * Simulate palm ROI extraction from full image.
 * In production this would use MediaPipe landmarks.
 */
function extractPalmROI(imageData) {
  const { width, height, data } = imageData;
  const roiSize = Math.min(width, height) * 0.7;
  const roiX = Math.floor((width - roiSize) / 2);
  const roiY = Math.floor((height - roiSize) / 2);
  const roiW = Math.floor(roiSize);
  const roiH = Math.floor(roiSize);

  const roiData = new Uint8ClampedArray(roiW * roiH * 4);
  for (let y = 0; y < roiH; y++) {
    for (let x = 0; x < roiW; x++) {
      const srcIdx = ((roiY + y) * width + (roiX + x)) * 4;
      const dstIdx = (y * roiW + x) * 4;
      roiData[dstIdx] = data[srcIdx];
      roiData[dstIdx + 1] = data[srcIdx + 1];
      roiData[dstIdx + 2] = data[srcIdx + 2];
      roiData[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return {
    width: roiW,
    height: roiH,
    data: roiData
  };
}

/**
 * Main runner.
 */
async function main() {
  const imagePath = process.argv[2];
  let imageData;
  let isSynthetic = false;

  console.log('='.repeat(60));
  console.log('PalmPyaar Phase 3B — Classical Palm-Line Candidate Prototype');
  console.log('FEASIBILITY STUDY ONLY — NOT PRODUCTION CODE');
  console.log('='.repeat(60));

  if (imagePath) {
    console.log(`\nLoading image: ${imagePath}`);
    try {
      imageData = await loadImageFromPath(imagePath);
    } catch (err) {
      console.error(`Failed to load image: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('\nNo image provided. Using synthetic test pattern.');
    console.log('WARNING: Synthetic pattern is NOT a real palm photo.');
    console.log('This run verifies pipeline execution only, not accuracy.\n');
    imageData = generateSyntheticPattern(240, 240);
    isSynthetic = true;
  }

  console.log(`Image size: ${imageData.width}x${imageData.height}`);

  const roi = extractPalmROI(imageData);
  console.log(`ROI size: ${roi.width}x${roi.height}`);

  const { gray, width, height } = toGrayscale(roi);
  console.log(`Grayscale conversion complete.`);

  console.log('\n--- Default Pipeline Run ---');
  const defaultResult = runPipeline(gray, width, height);
  console.log(`Processing time: ${defaultResult.metrics.processingTimeMs}ms`);
  console.log(`Raw edge pixels: ${defaultResult.metrics.rawEdgePixels}`);
  console.log(`Raw segments: ${defaultResult.metrics.rawSegments}`);
  console.log(`Filtered candidates: ${defaultResult.metrics.filteredCandidates}`);
  console.log(`Candidates:`);
  for (const c of defaultResult.candidates) {
    console.log(`  ${c.id}: length=${c.lengthPx}px, angle=${c.angleDeg}°, region=${c.region}`);
  }

  console.log('\n--- Parameter Sweep ---');
  const sweepResults = runParameterSweep(gray, width, height);
  for (const sweep of sweepResults) {
    console.log(`\n[${sweep.label}] candidates=${sweep.result.metrics.filteredCandidates}, time=${sweep.result.metrics.processingTimeMs}ms`);
  }

  console.log('\n--- Stability Analysis ---');
  console.log('Rotation and resolution stability tests require real palm photos.');
  console.log('Skipping — no real palm-photo fixtures available in repository.');

  console.log('\n--- Noise Assessment ---');
  console.log('Noise assessment requires real palm photos with known lighting conditions.');
  console.log('Skipping — no real palm-photo fixtures available in repository.');

  if (isSynthetic) {
    console.log('\n*** IMPORTANT LIMITATION ***');
    console.log('This run used a synthetic test pattern, not a real palm photo.');
    console.log('Phase 3B cannot be accuracy-validated until real palm-photo fixtures are supplied.');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Pipeline execution complete.');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Prototype runner failed:', err);
  process.exit(1);
});
