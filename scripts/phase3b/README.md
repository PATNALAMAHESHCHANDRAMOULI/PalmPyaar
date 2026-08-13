# Phase 3B — Classical Palm-Line Candidate Extraction Feasibility Prototype

## Status: FEASIBILITY STUDY ONLY — NOT PRODUCTION CODE

This directory contains an isolated prototype for investigating whether classical computer vision can reliably extract anonymous palm-line candidate segments from real palm photos.

**This prototype is NOT integrated into production PalmPyaar.** It does not modify:
- `index.html`
- `js/palmValidator.js`
- `js/teaser.js`
- `js/checkout.js`
- `api/create-payment.js`
- `api/verify-razorpay.js`
- `api/generate-reading.js`
- Any Groq prompt or template
- Any payment or security flow

## Files

| File | Purpose |
|------|---------|
| `prototypePalmLines.js` | Core CV pipeline: grayscale, CLAHE, blur, Canny, morphology, HoughLinesP, filtering, region classification |
| `runNodePrototype.js` | Node.js runner. Uses `canvas` package for image I/O. |
| `README.md` | This file. |

## Pipeline

```
Image (client-side, never uploaded)
  → ROI extraction (center crop or landmark-based)
  → Grayscale conversion
  → CLAHE contrast normalization
  → Gaussian blur denoising
  → Canny edge detection
  → Morphological dilation
  → HoughLinesP segment extraction
  → Boundary / noise / density filtering
  → Anonymous candidate JSON
```

## Anonymous Candidate Format

```json
{
  "id": "candidate_1",
  "lengthPx": 123.4,
  "angleDeg": 15.2,
  "start": { "x": 10, "y": 20 },
  "end": { "x": 130, "y": 50 },
  "region": "upper_palm"
}
```

**Region labels are purely geometric:**
- `upper_palm` — top third of ROI
- `middle_palm` — middle third of ROI
- `lower_palm` — bottom third of ROI
- `left_palm` / `right_palm` — lateral divisions

**Forbidden region labels (never used):**
- heart_line, head_line, life_line, fate_line, venus_mount, etc.

## Parameters Tested

The prototype includes a parameter sweep across 5 conservative configurations:

| Label | CLAHE Clip | Blur Kernel | Canny Low/High | Hough Threshold | Min Length | Boundary Margin |
|-------|-----------|-------------|----------------|-----------------|------------|-----------------|
| conservative | 1.5 | 5x5, σ=1.0 | 25/70 | 30 | 12px | 10% |
| default | 2.0 | 5x5, σ=1.0 | 30/80 | 25 | 10px | 8% |
| aggressive_edges | 2.5 | 3x3, σ=0.8 | 20/60 | 20 | 8px | 6% |
| denoise_heavy | 2.0 | 7x7, σ=1.4 | 35/90 | 35 | 15px | 10% |
| fine_segments | 2.0 | 3x3, σ=0.8 | 30/80 | 15 | 6px | 8% |

## Running the Prototype

### Prerequisites

```bash
npm install canvas --no-save
```

### Basic run (synthetic smoke test)

```bash
node scripts/phase3b/runNodePrototype.js
```

### Run with a real palm photo

```bash
node scripts/phase3b/runNodePrototype.js path/to/palm-photo.jpg
```

**Important:** Real palm photos must be supplied by the user. This repository contains no palm-photo fixtures.

## OpenCV.js Investigation

### Availability

OpenCV.js is available via multiple CDNs:

| Source | URL Pattern | License |
|--------|------------|---------|
| TechStark (npm/jsDelivr) | `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js` | Apache-2.0 |
| Official OpenCV docs | `https://docs.opencv.org/4.x/opencv.js` | Apache-2.0 |
| unpkg | `https://unpkg.com/@techstark/opencv-js@4.12.0-release.1/dist/opencv.js` | Apache-2.0 |

### License

Apache-2.0 — permissive, commercial-friendly, no copyleft restrictions. Compatible with PalmPyaar's ISC license.

### Bundle Size

~13 MB (WebAssembly build). This is a **hard stop concern** for mobile:
- 13 MB initial download on a mobile network (4G/5G) adds 2-5 seconds of load time
- Subsequent visits may be cached, but first-load UX is significantly degraded
- WebAssembly compilation adds additional startup latency

### Browser Compatibility

- Works in modern browsers (Chrome, Firefox, Safari, Edge)
- Requires WebAssembly support
- Mobile browsers are supported but performance varies

### CSP Implications

Current `index.html` has **no CSP headers**. If CSP is added in the future:
- OpenCV.js from CDN requires `script-src` allowance for the CDN origin
- The WASM file requires `wasm-unsafe-eval` or equivalent
- This is manageable but must be coordinated with any future CSP policy

### Mobile Performance

- OpenCV.js runs on mobile but is noticeably slower than desktop
- Canny + HoughLinesP on a 200x200 ROI may take 200-500ms on mid-range mobile
- This is borderline acceptable for a paid-reading flow but would benefit from Web Worker offloading

### Why This Prototype Does NOT Use OpenCV.js

1. **No real palm photos available** — accuracy cannot be validated
2. **13 MB bundle cost** — unacceptable for first-load mobile UX without proven value
3. **Isolation requirement** — Phase 3B must not modify production `index.html` or add CDN dependencies
4. **Pure-JS implementation** — the prototype uses `canvas` (Node.js only) to demonstrate the algorithm; the browser version would use HTML Canvas + manual pixel manipulation, which is sufficient for the simple operations used here

## Hard Stop Conditions

| Condition | Status |
|-----------|--------|
| 1. Candidates dominated by finger/hand boundaries | Unknown — needs real photos |
| 2. Lighting changes dramatically alter output | Unknown — needs real photos |
| 3. Small preprocessing changes cause large changes | Unknown — needs real photos |
| 4. Rotation causes major instability | Unknown — needs real photos |
| 5. Skin texture/noise dominates | Unknown — needs real photos |
| 6. Same palm produces materially different candidates | Unknown — needs real photos |
| 7. Mobile processing too slow | ~200-500ms estimated for 200x200 ROI on mid-range mobile — borderline |
| 8. OpenCV.js bundle/load cost | ~13 MB — hard stop for production without proven value |
| 9. CSP/CDN conflicts | No current CSP, but future CSP would need explicit allowances |
| 10. Insufficient real palm photos | **TRIGGERED** — no palm-photo fixtures in repository |

## Limitations

1. **No real palm photos in repository.** Accuracy, stability, and noise assessments cannot be performed without real test fixtures.
2. **Synthetic pattern smoke test only.** The included synthetic test verifies code execution, not palm-line extraction quality.
3. **Simplified Canny implementation.** The prototype uses a basic Sobel-based Canny. Production OpenCV.js would use the optimized native implementation.
4. **No GPU acceleration.** The prototype runs on CPU. Mobile performance would benefit from WebGL shaders or WebAssembly SIMD.
5. **ROI extraction is simulated.** The prototype uses a center crop. Production would use MediaPipe landmarks for anatomically accurate ROI.

## Accuracy Validation Status

**Phase 3B cannot be accuracy-validated until real palm-photo fixtures are supplied.**

No synthetic test results are claimed as real-world validation.

## Next Steps (If Approved)

1. Collect real palm-photo dataset (left/right palms, multiple skin tones, lighting conditions, rotations)
2. Run pipeline on real photos with ground-truth annotation
3. Measure candidate stability across resolution/rotation
4. If results are stable and meaningful, consider production integration
5. If results are unstable or dominated by noise, recommend abandoning classical CV

## Recommendation

**DO NOT proceed to production integration.** The feasibility of classical palm-line extraction cannot be determined without real palm-photo fixtures. The 13 MB OpenCV.js bundle cost is a hard stop unless the technique proves dramatically useful.

The prototype code is ready for evaluation once real test images are available.
