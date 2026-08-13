/**
 * PalmPyaar Phase 3B — Classical Palm-Line Candidate Extraction Prototype
 *
 * FEASIBILITY STUDY ONLY. NOT PRODUCTION CODE.
 *
 * This module implements a classical CV pipeline for extracting anonymous
 * line-candidate segments from a palm ROI. It does NOT:
 * - Detect heart/head/life/fate lines
 * - Classify mounts
 * - Infer personality or predictions
 * - Send data to Groq or any external service
 *
 * The only acceptable output is anonymous geometric candidates.
 *
 * Pipeline:
 *   1. Grayscale conversion
 *   2. Contrast normalization (CLAHE-like)
 *   3. Denoising (Gaussian blur)
 *   4. Edge extraction (Canny)
 *   5. Morphological operations (dilate/erode)
 *   6. Line segment extraction (HoughLinesP)
 *   7. Boundary/noise filtering
 *   8. Anonymous candidate output
 *
 * @module scripts/phase3b/prototypePalmLines
 */

'use strict';

const CANVAS_AVAILABLE = (() => {
  try {
    require('canvas');
    return true;
  } catch (e) {
    return false;
  }
})();

if (!CANVAS_AVAILABLE) {
  console.warn('[Phase3B] Node.js canvas not available. Browser-only mode.');
}

/**
 * Convert ImageData or raw RGBA buffer to grayscale 2D array.
 * @param {Object} source - { width, height, data } (ImageData-like)
 * @returns {Float32Array} grayscale values [0, 255]
 */
function toGrayscale(source) {
  const { width, height, data } = source;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { gray, width, height };
}

/**
 * Simple CLAHE-like contrast normalization.
 * Uses adaptive histogram equalization on blocks.
 *
 * @param {Float32Array} gray - grayscale image
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {number} clipLimit - contrast limit (default 2.0)
 * @param {number} tileSize - block size (default 8)
 * @returns {Float32Array} contrast-normalized grayscale
 */
function contrastNormalize(gray, width, height, clipLimit = 2.0, tileSize = 8) {
  const result = new Float32Array(gray.length);
  const blockWidth = Math.ceil(width / tileSize);
  const blockHeight = Math.ceil(height / tileSize);

  for (let by = 0; by < blockHeight; by++) {
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * tileSize;
      const startY = by * tileSize;
      const endX = Math.min(startX + tileSize, width);
      const endY = Math.min(startY + tileSize, height);

      const hist = new Float32Array(256);
      const blockSize = (endX - startX) * (endY - startY);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          const val = Math.round(Math.max(0, Math.min(255, gray[idx])));
          hist[val]++;
        }
      }

      const avgCount = blockSize / 256;
      const limit = Math.max(1, clipLimit * avgCount);
      let clipped = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) {
          clipped += hist[i] - limit;
          hist[i] = limit;
        }
      }
      const increment = clipped / 256;
      for (let i = 0; i < 256; i++) {
        hist[i] += increment;
      }

      const cdf = new Float32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i - 1] + hist[i];
      }
      const cdfMin = cdf[0];
      const cdfMax = cdf[255];

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          const val = Math.round(Math.max(0, Math.min(255, gray[idx])));
          const lutVal = cdfMax > cdfMin ? Math.round(((cdf[val] - cdfMin) / (cdfMax - cdfMin)) * 255) : val;
          result[idx] = Math.max(0, Math.min(255, lutVal));
        }
      }
    }
  }

  return result;
}

/**
 * Apply Gaussian blur for denoising.
 * Uses separable 1D passes for efficiency.
 *
 * @param {Float32Array} gray - grayscale image
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {number} kernelSize - must be odd (default 5)
 * @param {number} sigma - Gaussian sigma (default 1.0)
 * @returns {Float32Array} blurred grayscale
 */
function gaussianBlur(gray, width, height, kernelSize = 5, sigma = 1.0) {
  const half = Math.floor(kernelSize / 2);
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + half] = val;
    sum += val;
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  const temp = new Float32Array(width * height);
  const result = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        val += gray[y * width + sx] * kernel[k + half];
      }
      temp[y * width + x] = val;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        val += temp[sy * width + x] * kernel[k + half];
      }
      result[y * width + x] = val;
    }
  }

  return result;
}

/**
 * Canny edge detection (simplified implementation).
 *
 * @param {Float32Array} gray - grayscale image
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {number} lowThreshold - low hysteresis threshold
 * @param {number} highThreshold - high hysteresis threshold
 * @returns {Uint8Array} binary edge map (0 or 255)
 */
function cannyEdge(gray, width, height, lowThreshold, highThreshold) {
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const ki = (ky + 1) * 3 + (kx + 1);
          gx += gray[idx] * sobelX[ki];
          gy += gray[idx] * sobelY[ki];
        }
      }
      magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
      direction[y * width + x] = Math.atan2(gy, gx);
    }
  }

  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      const dir = direction[idx];

      const dirDeg = ((dir * 180 / Math.PI) + 180) % 180;
      let isMax = true;

      if (dirDeg < 22.5 || dirDeg >= 157.5) {
        if (mag < magnitude[idx - 1] || mag < magnitude[idx + 1]) isMax = false;
      } else if (dirDeg < 67.5) {
        if (mag < magnitude[idx - width + 1] || mag < magnitude[idx + width - 1]) isMax = false;
      } else if (dirDeg < 112.5) {
        if (mag < magnitude[idx - width] || mag < magnitude[idx + width]) isMax = false;
      } else {
        if (mag < magnitude[idx - width - 1] || mag < magnitude[idx + width + 1]) isMax = false;
      }

      if (isMax) {
        if (mag >= highThreshold) {
          edges[idx] = 255;
        } else if (mag >= lowThreshold) {
          edges[idx] = 128;
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (edges[idx] === 128) {
        let connected = false;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            if (kx === 0 && ky === 0) continue;
            if (edges[idx + ky * width + kx] === 255) {
              connected = true;
              break;
            }
          }
          if (connected) break;
        }
        edges[idx] = connected ? 255 : 0;
      }
    }
  }

  return edges;
}

/**
 * Morphological dilation to connect broken edges.
 *
 * @param {Uint8Array} edges - binary edge map
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {number} iterations - dilation iterations (default 1)
 * @returns {Uint8Array} dilated edge map
 */
function dilateEdges(edges, width, height, iterations = 1) {
  let current = new Uint8Array(edges);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let maxVal = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            maxVal = Math.max(maxVal, current[(y + ky) * width + (x + kx)]);
          }
        }
        next[y * width + x] = maxVal;
      }
    }
    current = next;
  }
  return current;
}

/**
 * HoughLinesP-like line segment extraction.
 * Simplified probabilistic Hough transform.
 *
 * @param {Uint8Array} edges - binary edge map
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {Object} params - Hough parameters
 * @returns {Array} array of {x1, y1, x2, y2, length, angle}
 */
function houghLinesP(edges, width, height, params = {}) {
  const rho = params.rho || 1;
  const thetaStep = params.theta || Math.PI / 180;
  const threshold = params.threshold || 30;
  const minLength = params.minLength || 10;
  const maxGap = params.maxGap || 5;

  const edgePoints = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 255) {
        edgePoints.push({ x, y });
      }
    }
  }

  if (edgePoints.length === 0) return [];

  const diag = Math.ceil(Math.sqrt(width * width + height * height));
  const accRhoSize = Math.ceil(diag * 2 / rho) + 1;
  const accThetaSize = Math.ceil(Math.PI / thetaStep);
  const accumulator = new Int32Array(accRhoSize * accThetaSize);

  for (let p = 0; p < edgePoints.length; p++) {
    const { x, y } = edgePoints[p];
    for (let t = 0; t < accThetaSize; t++) {
      const theta = t * thetaStep;
      const r = Math.round((x * Math.cos(theta) + y * Math.sin(theta)) / rho);
      const ri = Math.round(r + diag);
      if (ri >= 0 && ri < accRhoSize) {
        accumulator[ri * accThetaSize + t]++;
      }
    }
  }

  const peaks = [];
  for (let ri = 0; ri < accRhoSize; ri++) {
    for (let t = 0; t < accThetaSize; t++) {
      if (accumulator[ri * accThetaSize + t] >= threshold) {
        peaks.push({ ri, t, count: accumulator[ri * accThetaSize + t], theta: t * thetaStep });
      }
    }
  }
  peaks.sort((a, b) => b.count - a.count);

  const used = new Uint8Array(edgePoints.length);
  const segments = [];
  const maxPeaks = Math.min(peaks.length, 50);

  for (let p = 0; p < maxPeaks; p++) {
    const peak = peaks[p];
    const rCenter = (peak.ri - diag) * rho;
    const theta = peak.theta;
    const perpX = -Math.sin(theta);
    const perpY = Math.cos(theta);

    const pts = [];
    for (let i = 0; i < edgePoints.length; i++) {
      if (used[i]) continue;
      const { x, y } = edgePoints[i];
      const r = x * Math.cos(theta) + y * Math.sin(theta);
      if (Math.abs(r - rCenter) <= rho * 2) {
        pts.push({ x, y, proj: x * perpX + y * perpY, idx: i });
      }
    }

    if (pts.length < 2) continue;

    pts.sort((a, b) => a.proj - b.proj);

    let segStart = pts[0];
    let segEnd = pts[0];

    for (let i = 1; i < pts.length; i++) {
      const gap = pts[i].proj - (segEnd.x * perpX + segEnd.y * perpY);
      if (gap <= maxGap) {
        segEnd = pts[i];
      } else {
        const sdx = segEnd.x - segStart.x;
        const sdy = segEnd.y - segStart.y;
        const segLen = Math.sqrt(sdx * sdx + sdy * sdy);
        if (segLen >= minLength) {
          segments.push({
            x1: Math.round(segStart.x),
            y1: Math.round(segStart.y),
            x2: Math.round(segEnd.x),
            y2: Math.round(segEnd.y),
            length: Math.round(segLen * 100) / 100,
            angle: Math.round(Math.atan2(sdy, sdx) * 180 / Math.PI * 100) / 100
          });
        }
        segStart = pts[i];
        segEnd = pts[i];
      }
    }

    const sdx = segEnd.x - segStart.x;
    const sdy = segEnd.y - segStart.y;
    const segLen = Math.sqrt(sdx * sdx + sdy * sdy);
    if (segLen >= minLength) {
      segments.push({
        x1: Math.round(segStart.x),
        y1: Math.round(segStart.y),
        x2: Math.round(segEnd.x),
        y2: Math.round(segEnd.y),
        length: Math.round(segLen * 100) / 100,
        angle: Math.round(Math.atan2(sdy, sdx) * 180 / Math.PI * 100) / 100
      });
    }

    if (segments.length >= 100) break;
  }

  return segments;
}

/**
 * Filter candidate segments to remove noise and hand boundaries.
 *
 * @param {Array} segments - raw segments from Hough
 * @param {number} width - ROI width
 * @param {number} height - ROI height
 * @param {Object} params - filtering parameters
 * @returns {Array} filtered anonymous candidates
 */
function filterCandidates(segments, width, height, params = {}) {
  const minLength = params.minLength || 15;
  const maxLength = params.maxLength || Math.max(width, height) * 0.85;
  const boundaryMargin = params.boundaryMargin || 0.08;
  const angleTolerance = params.angleTolerance || 8;
  const maxDensity = params.maxDensity || 6;

  const marginX = width * boundaryMargin;
  const marginY = height * boundaryMargin;
  const diag = Math.sqrt(width * width + height * height);

  let filtered = segments.filter(seg => {
    if (seg.length < minLength || seg.length > maxLength) return false;

    const nearBoundary =
      seg.x1 < marginX || seg.x1 > width - marginX ||
      seg.y1 < marginY || seg.y1 > height - marginY ||
      seg.x2 < marginX || seg.x2 > width - marginX ||
      seg.y2 < marginY || seg.y2 > height - marginY;

    if (nearBoundary) return false;

    return true;
  });

  const angleBuckets = {};
  for (const seg of filtered) {
    const bucket = Math.round(seg.angle / angleTolerance);
    if (!angleBuckets[bucket]) angleBuckets[bucket] = [];
    angleBuckets[bucket].push(seg);
  }

  const densityBuckets = {};
  const cellSize = Math.max(20, Math.min(width, height) / 8);
  for (const seg of filtered) {
    const cx = Math.floor(((seg.x1 + seg.x2) / 2) / cellSize);
    const cy = Math.floor(((seg.y1 + seg.y2) / 2) / cellSize);
    const key = `${cx},${cy}`;
    if (!densityBuckets[key]) densityBuckets[key] = [];
    densityBuckets[key].push(seg);
  }

  const survivors = [];
  for (const seg of filtered) {
    const bucket = Math.round(seg.angle / angleTolerance);
    const cx = Math.floor(((seg.x1 + seg.x2) / 2) / cellSize);
    const cy = Math.floor(((seg.y1 + seg.y2) / 2) / cellSize);
    const key = `${cx},${cy}`;
    const cellDensity = (densityBuckets[key] || []).length;

    if ((angleBuckets[bucket] || []).length <= maxDensity && cellDensity <= maxDensity) {
      survivors.push(seg);
    }
  }

  return survivors;
}

/**
 * Classify segment into geometric regions.
 * Regions are purely geometric, NOT palmistry terms.
 *
 * @param {Object} seg - segment with x1,y1,x2,y2
 * @param {number} width - ROI width
 * @param {number} height - ROI height
 * @returns {string} region label
 */
function classifyRegion(seg, width, height) {
  const cx = (seg.x1 + seg.x2) / 2;
  const cy = (seg.y1 + seg.y2) / 2;
  const relX = cx / width;
  const relY = cy / height;

  const vertical = relY < 0.33 ? 'upper' : relY < 0.66 ? 'middle' : 'lower';
  const horizontal = relX < 0.5 ? 'left' : 'right';

  const isCentral = relX > 0.3 && relX < 0.7 && relY > 0.2 && relY < 0.8;
  if (isCentral && vertical === 'middle') return 'middle_palm';

  if (vertical === 'upper' && horizontal === 'left') return 'upper_palm';
  if (vertical === 'upper' && horizontal === 'right') return 'upper_palm';
  if (vertical === 'lower' && horizontal === 'left') return 'lower_palm';
  if (vertical === 'lower' && horizontal === 'right') return 'lower_palm';

  return vertical + '_palm';
}

/**
 * Run the complete Phase 3B pipeline on a grayscale image array.
 *
 * @param {Float32Array} gray - grayscale pixel values
 * @param {number} width - image width
 * @param {number} height - image height
 * @param {Object} [overrides] - parameter overrides for experimentation
 * @returns {Object} pipeline result with candidates and metrics
 */
function runPipeline(gray, width, height, overrides = {}) {
  const startTime = Date.now();

  const params = {
    claheClip: overrides.claheClip || 2.0,
    claheTile: overrides.claheTile || 8,
    blurKernel: overrides.blurKernel || 5,
    blurSigma: overrides.blurSigma || 1.0,
    cannyLow: overrides.cannyLow || 30,
    cannyHigh: overrides.cannyHigh || 80,
    morphIterations: overrides.morphIterations || 1,
    houghRho: overrides.houghRho || 1,
    houghTheta: overrides.houghTheta || Math.PI / 180,
    houghThreshold: overrides.houghThreshold || 25,
    houghMinLength: overrides.houghMinLength || 10,
    houghMaxGap: overrides.houghMaxGap || 4,
    minLength: overrides.minLength || 12,
    maxLength: overrides.maxLength || Math.max(width, height) * 0.8,
    boundaryMargin: overrides.boundaryMargin || 0.08,
    angleTolerance: overrides.angleTolerance || 8,
    maxDensity: overrides.maxDensity || 6,
    ...overrides
  };

  const metrics = {
    roiWidth: width,
    roiHeight: height,
    totalPixels: width * height,
    rawEdgePixels: 0,
    rawSegments: 0,
    filteredCandidates: 0,
    processingTimeMs: 0,
    paramsUsed: params
  };

  let current = new Float32Array(gray);

  current = contrastNormalize(current, width, height, params.claheClip, params.claheTile);
  current = gaussianBlur(current, width, height, params.blurKernel, params.blurSigma);
  const edges = cannyEdge(current, width, height, params.cannyLow, params.cannyHigh);
  edges.forEach((v, i) => { if (v === 255) metrics.rawEdgePixels++; });
  const dilated = dilateEdges(edges, width, height, params.morphIterations);
  const rawSegments = houghLinesP(dilated, width, height, {
    rho: params.houghRho,
    theta: params.houghTheta,
    threshold: params.houghThreshold,
    minLength: params.houghMinLength,
    maxGap: params.houghMaxGap
  });
  metrics.rawSegments = rawSegments.length;

  const filtered = filterCandidates(rawSegments, width, height, {
    minLength: params.minLength,
    maxLength: params.maxLength,
    boundaryMargin: params.boundaryMargin,
    angleTolerance: params.angleTolerance,
    maxDensity: params.maxDensity
  });
  metrics.filteredCandidates = filtered.length;

  const candidates = filtered.map((seg, idx) => ({
    id: `candidate_${idx + 1}`,
    lengthPx: Math.round(seg.length * 100) / 100,
    angleDeg: Math.round(seg.angle * 100) / 100,
    start: { x: Math.round(seg.x1), y: Math.round(seg.y1) },
    end: { x: Math.round(seg.x2), y: Math.round(seg.y2) },
    region: classifyRegion(seg, width, height)
  }));

  metrics.processingTimeMs = Date.now() - startTime;

  return {
    candidates,
    metrics,
    evidence: {
      palmBounds: null,
      fingerRatios: null,
      geometricRatios: null,
      palmAngle: null,
      lineCandidates: candidates
    }
  };
}

/**
 * Run multiple parameter combinations for sensitivity analysis.
 *
 * @param {Float32Array} gray - grayscale image
 * @param {number} width - image width
 * @param {number} height - image height
 * @returns {Array} array of { params, result }
 */
function runParameterSweep(gray, width, height) {
  const parameterSets = [
    { label: 'conservative', claheClip: 1.5, claheTile: 8, blurKernel: 5, blurSigma: 1.0, cannyLow: 25, cannyHigh: 70, houghThreshold: 30, houghMinLength: 12, houghMaxGap: 3, minLength: 12, boundaryMargin: 0.10 },
    { label: 'default', claheClip: 2.0, claheTile: 8, blurKernel: 5, blurSigma: 1.0, cannyLow: 30, cannyHigh: 80, houghThreshold: 25, houghMinLength: 10, houghMaxGap: 4, minLength: 10, boundaryMargin: 0.08 },
    { label: 'aggressive_edges', claheClip: 2.5, claheTile: 6, blurKernel: 3, blurSigma: 0.8, cannyLow: 20, cannyHigh: 60, houghThreshold: 20, houghMinLength: 8, houghMaxGap: 6, minLength: 8, boundaryMargin: 0.06 },
    { label: 'denoise_heavy', claheClip: 2.0, claheTile: 10, blurKernel: 7, blurSigma: 1.4, cannyLow: 35, cannyHigh: 90, houghThreshold: 35, houghMinLength: 15, houghMaxGap: 3, minLength: 15, boundaryMargin: 0.10 },
    { label: 'fine_segments', claheClip: 2.0, claheTile: 8, blurKernel: 3, blurSigma: 0.8, cannyLow: 30, cannyHigh: 80, houghThreshold: 15, houghMinLength: 6, houghMaxGap: 3, minLength: 6, boundaryMargin: 0.08 }
  ];

  return parameterSets.map(set => {
    const result = runPipeline(gray, width, height, set);
    return {
      label: set.label,
      params: set,
      result
    };
  });
}

module.exports = {
  toGrayscale,
  contrastNormalize,
  gaussianBlur,
  cannyEdge,
  dilateEdges,
  houghLinesP,
  filterCandidates,
  classifyRegion,
  runPipeline,
  runParameterSweep
};
