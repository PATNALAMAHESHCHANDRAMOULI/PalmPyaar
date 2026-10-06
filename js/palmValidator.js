/**
 * PalmPyaar Palm Validator — client-side hand/palm image validation.
 *
 * Uses MediaPipe Hands (free, browser-side, CDN-hosted).
 * The library and its model are lazy-loaded ONLY when the user first
 * selects a photo, so idle visitors pay zero bandwidth for computer vision.
 *
   * Validation pipeline:
   *   1. File type check (image/*)
   *   2. File size check (≤ 10 MB)
   *   3. Load image element in-browser
   *   4. Dimension check (≥ 200 px on the shortest side)
   *   5. Photo quality check (brightness, contrast, focus)
   *   6. Run MediaPipe Hands detection (minDetectionConfidence 0.5 enforced by MediaPipe options)
   *   7. Require exactly one hand
   *   8. Geometric check: fingers should be extended (open palm, not a fist)
   *   9. Visual side check (fingertip pixel saturation: palm vs back of hand)
   *  10. Palm usability check (crop, spread, orientation, back-of-hand heuristic)
   *  11. Extract normalized geometry (palmBounds, fingerRatios, geometricRatios, palmAngle)
   *
   * The raw image stays in the browser — it is never uploaded to any service.
   * Only a SHA-256 hash is ever sent to the server (handled by teaser.js).
   * palmEvidence is also generated client-side and threaded through the signed
   * payment/reading tokens for tamper-evidence.
 */
var PalmValidator = (function () {
  'use strict';

  var handsInstance = null;
  var modelReady = false;
  var loadingPromise = null;
  var validating = false;

  var MEDIAPIPE_VERSION = '0.4';
  var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  var MIN_DIMENSION = 200;
  var MIN_CONFIDENCE = 0.5;

  var SCRIPT_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@' + MEDIAPIPE_VERSION + '/';

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-mp-src="' + src + '"]')) {
        resolve();
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-mp-src', src);
      script.onload = function () { resolve(); };
      script.onerror = function () {
        reject(new Error('Failed to load library: ' + src));
      };
      document.head.appendChild(script);
    });
  }

  function loadModel() {
    if (modelReady) return Promise.resolve();
    if (loadingPromise) return loadingPromise;

    loadingPromise = new Promise(function (resolve, reject) {
      injectScript(SCRIPT_BASE + 'hands.js')
        .then(function () {
          if (typeof Hands === 'undefined') {
            throw new Error('MediaPipe Hands library not available after loading.');
          }

          handsInstance = new Hands({
            locateFile: function (file) {
              return SCRIPT_BASE + file;
            }
          });

          handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: MIN_CONFIDENCE,
            minTrackingConfidence: MIN_CONFIDENCE
          });

          modelReady = true;
          resolve();
        })
        .catch(function (err) {
          loadingPromise = null;
          reject(err);
        });
    });

    return loadingPromise;
  }

  /**
   * Heuristic: check whether the detected hand landmarks correspond to an
   * open palm (fingers extended) rather than a fist or heavily curled hand.
   *
   * Returns true if at least 3 of the 4 fingers (index, middle, ring, pinky)
   * have their tip above (lower y) their PIP joint — i.e. extended.
   */
  function isHandOpen(landmarks) {
    var fingerTips = [8, 12, 16, 20];   // index, middle, ring, pinky fingertips
    var fingerPIPs = [6, 10, 14, 18];   // matching PIP joints

    var extendedCount = 0;
    for (var i = 0; i < fingerTips.length; i++) {
      var tip = landmarks[fingerTips[i]];
      var pip = landmarks[fingerPIPs[i]];
      if (tip && pip && tip.y < pip.y) {
        extendedCount++;
      }
    }

    return extendedCount >= 3;
  }

  /**
   * Heuristic: estimate whether the hand is palm-facing (vs back of hand).
   *
   * With 2-D landmarks alone we cannot reliably distinguish palm vs dorsal
   * side, but we can flag obviously rotated/sideways hands so the user can
   * re-take the photo.  We check that the hand's bounding box is roughly
   * wider than tall (a palm view is typically wider than a profile/side view).
   */
  function isPalmFacing(landmarks) {
    var xs = [];
    var ys = [];
    for (var i = 0; i < landmarks.length; i++) {
      xs.push(landmarks[i].x);
      ys.push(landmarks[i].y);
    }
    var width = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    var height = Math.max.apply(null, ys) - Math.min.apply(null, ys);

    // A palm-facing open hand is typically at least as wide as it is tall.
    // If it is much taller than wide, it may be a side view.
    return width >= height * 0.6;
  }

  /**
   * Customer-facing request messages for unusable photos, in the languages
   * the product ships localized copy for. Two situations are covered:
   * `quality` (too dark / too bright / flat / out of focus) and `palm`
   * (framing, spread, orientation or a structural back-of-hand heuristic).
   * English is the default whenever the browser language has no pack.
   */
  var PHOTO_REQUEST_MESSAGES = {
    en: {
      quality: 'We could not read this photo clearly. Please upload a sharper, well-lit photo of your open palm and try again.',
      palm: 'Please upload a photo of your open palm facing the camera, with fingers spread and fully visible, like a high-five. Then try again.'
    },
    te: {
      quality: 'ఈ ఫోటో స్పష్టంగా కనిపించలేదు. మీ అరచేతి ఫోటోను మెరుగైన వెలుతురులో, స్పష్టంగా తీసి మళ్ళీ ప్రయత్నించండి.',
      palm: 'మీ అరచేతి కెమెరా వైపు చూస్తూ, వేళ్ళు విస్తరించి పూర్తిగా కనిపించేలా ఫోటో తీయండి, హై-ఫైవ్ లాగా. తర్వాత మళ్ళీ ప్రయత్నించండి.'
    },
    hi: {
      quality: 'यह फ़ोटो साफ़ नहीं दिख रही. कृपया अपनी खुली हथेली की रोशनी में खींची गई तेज़ फ़ोटो अपलोड करें और फिर कोशिश करें.',
      palm: 'कृपया ऐसी फ़ोटो लगाएँ जिसमें आपकी खुली हथेली कैमरे की ओर हो, उंगलियाँ फैली हुईं और पूरी दिख रही हों, जैसे हाई-फ़ाइव. फिर दोबारा कोशिश करें.'
    },
    ta: {
      quality: 'இந்த புகைப்படம் தெளிவாக தெரியவில்லை. உங்கள் திறந்த உள்ளங்கையை நல்ல வெளிச்சத்தில் தெளிவாக எடுத்து மீண்டும் முயற்சிக்கவும்.',
      palm: 'உங்கள் திறந்த உள்ளங்கை கேமராவை நோக்கியும், விரல்கள் விரிந்து முழுமையாக தெரியும்படியும் புகைப்படம் எடுக்கவும், ஹை-ஃபைவ் போல. பின் மீண்டும் முயற்சிக்கவும்.'
    },
    kn: {
      quality: 'ಈ ಫೋಟೋ ಸ್ಪಷ್ಟವಾಗಿ ಕಾಣುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ತೆರೆದ ಹಸ್ತವನ್ನು ಉತ್ತಮ ಬೆಳಕಿನಲ್ಲಿ ಸ್ಪಷ್ಟವಾಗಿ ಫೋಟೋ ತೆಗೆದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      palm: 'ನಿಮ್ಮ ತೆರೆದ ಹಸ್ತ ಕ್ಯಾಮೆರಾ ಕಡೆಗೆ ಇರುವಂತೆ, ಬೆರಳುಗಳು ಚಾಚಿ ಪೂರ್ತಿ ಕಾಣುವಂತೆ ಫೋಟೋ ತೆಗೆದುಕೊಳ್ಳಿ, ಹೈ-ಫೈವ್ ರೀತಿಯಲ್ಲಿ. ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'
    },
    ml: {
      quality: 'ഈ ഫോട്ടോ വ്യക്തമായി കാണുന്നില്ല. നിങ്ങളുടെ തുറന്ന കൈപ്പത്തി നല്ല വെളിച്ചത്തിൽ വ്യക്തമായി പകർത്തി വീണ്ടും ശ്രമിക്കുക.',
      palm: 'നിങ്ങളുടെ തുറന്ന കൈപ്പത്തി ക്യാമറയെ നോക്കിയും വിരലുകൾ വിരിഞ്ഞ് പൂർണ്ണമായി കാണുന്ന രീതിയിലും ഫോട്ടോ എടുക്കുക, ഹൈ-ഫൈവ് പോലെ. പിന്നീട് വീണ്ടും ശ്രമിക്കുക.'
    }
  };

  /** Localized photo-request message. `kind` is 'quality' or 'palm'. */
  function getPhotoRequestMessage(kind) {
    var lang = 'en';
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        lang = String(navigator.language).toLowerCase().split('-')[0];
      }
    } catch (e) { /* English default */ }
    var pack = PHOTO_REQUEST_MESSAGES[lang] || PHOTO_REQUEST_MESSAGES.en;
    return kind === 'quality' ? pack.quality : pack.palm;
  }

  /**
   * Structural back-of-hand heuristic score (0-4) over 2-D landmarks.
   * 2-D landmarks cannot truly separate palm from back of hand, so several
   * weak, independent cues are counted and only a clear cluster (score >= 2)
   * is treated as a rejectable photo. This is a photo-usability signal, never
   * a claim about lines, mounts or any printed feature.
   *
   * Cues:
   *   1. mean fingertip z is farther from the camera than the finger roots
   *   2. thumb tucked in against the hand rather than spread
   *   3. hand bounding box much taller than wide
   *   4. fingertips not fanned relative to the finger roots
   */
  function assessOrientation(landmarks) {
    if (!landmarks || landmarks.length < 21) return 0;
    var lm = landmarks;
    var xs = [], ys = [], i;
    for (i = 0; i < 21; i++) {
      xs.push(lm[i].x);
      ys.push(lm[i].y);
    }
    var width = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    var height = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    if (width <= 0 || height <= 0) return 0;

    function dist(a, b) {
      var dx = a.x - b.x;
      var dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    var score = 0;
    var tipZ = (lm[8].z + lm[12].z + lm[16].z + lm[20].z) / 4;
    var rootZ = (lm[5].z + lm[9].z + lm[13].z + lm[17].z) / 4;
    if (typeof tipZ === 'number' && typeof rootZ === 'number' && tipZ > rootZ + 0.02) score++;
    if (dist(lm[4], lm[5]) / width < 0.18) score++;
    if (height > width * 1.5) score++;
    if (dist(lm[8], lm[20]) / Math.max(dist(lm[5], lm[17]), 0.000001) < 1.02) score++;
    return score;
  }

  /**
   * Blocking usability checks for a detected hand, run in addition to the
   * open-palm check. Pure geometry over the 2-D landmark set: catches photos
   * that are cut off, too small, sideways, closed, fingers-together, or that
   * structurally resemble a back of hand. Returns { ok, problem } where
   * problem is a stable machine code for tests and logs.
   */
  function assessPalmUsability(landmarks) {
    if (!landmarks || landmarks.length < 21) {
      return { ok: false, problem: 'missing_hand' };
    }
    var xs = [], ys = [], i;
    for (i = 0; i < landmarks.length; i++) {
      xs.push(landmarks[i].x);
      ys.push(landmarks[i].y);
    }
    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    var width = maxX - minX;
    var height = maxY - minY;
    if (width <= 0 || height <= 0) return { ok: false, problem: 'degenerate' };

    for (i = 0; i < landmarks.length; i++) {
      if (landmarks[i].x < 0.01 || landmarks[i].x > 0.99 ||
          landmarks[i].y < 0.01 || landmarks[i].y > 0.99) {
        return { ok: false, problem: 'cropped' };
      }
    }

    if (width * height < 0.04) return { ok: false, problem: 'too_small' };

    var extended = 0;
    var tips = [8, 12, 16, 20];
    var pips = [6, 10, 14, 18];
    for (i = 0; i < tips.length; i++) {
      var tip = landmarks[tips[i]];
      var pip = landmarks[pips[i]];
      if (tip && pip && tip.y < pip.y) extended++;
    }
    if (extended < 3) return { ok: false, problem: 'fingers_closed' };

    function dist(a, b) {
      var dx = a.x - b.x;
      var dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    if (dist(landmarks[8], landmarks[20]) / width < 0.26) {
      return { ok: false, problem: 'fingers_together' };
    }

    if (width < height * 0.6) return { ok: false, problem: 'sideways' };

    if (assessOrientation(landmarks) >= 2) {
      return { ok: false, problem: 'back_of_hand' };
    }

    return { ok: true, problem: null };
  }

  /**
   * Photo-level quality checks over a small down-sampled pixel copy
   * ({ data, width, height }, RGBA). Returns { mean, contrast, sharpness,
   * problem } with problem null for a usable photo, or null when there is
   * not enough pixel data to judge. `sharpness` is the variance of a simple
   * Laplacian over the interior: near zero for smooth or out-of-focus frames.
   */
  function analyzeImageQuality(image) {
    var data = image && image.data;
    var width = image && image.width;
    var height = image && image.height;
    if (!data || typeof width !== 'number' || typeof height !== 'number') return null;
    if (width < 3 || height < 3 || data.length < width * height * 4) return null;

    var count = width * height;
    var gray = [];
    var sum = 0;
    var p;
    for (p = 0; p < count; p++) {
      var v = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
      gray.push(v);
      sum += v;
    }
    var mean = sum / count;
    var varSum = 0;
    for (p = 0; p < count; p++) {
      var d = gray[p] - mean;
      varSum += d * d;
    }
    var contrast = Math.sqrt(varSum / count);

    var lapSum = 0;
    var lapSq = 0;
    var lapCount = 0;
    for (var y = 1; y < height - 1; y++) {
      for (var x = 1; x < width - 1; x++) {
        var idx = y * width + x;
        var lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - width] - gray[idx + width];
        lapSum += lap;
        lapSq += lap * lap;
        lapCount++;
      }
    }
    var sharpness = 0;
    if (lapCount > 0) {
      var lapMean = lapSum / lapCount;
      sharpness = lapSq / lapCount - lapMean * lapMean;
    }

    var problem = null;
    if (mean < 35) problem = 'too_dark';
    else if (mean > 215) problem = 'too_bright';
    else if (contrast < 12) problem = 'low_contrast';
    else if (sharpness < 8) problem = 'blurry';

    return { mean: mean, contrast: contrast, sharpness: sharpness, problem: problem };
  }

  /**
   * Draw the loaded image into a tiny canvas (max 64px side) and return its
   * RGBA pixels for analyzeImageQuality. Returns null whenever no canvas is
   * available (non-browser contexts) or drawing is refused, in which case
   * the quality check is skipped rather than blocking the upload.
   */
  function sampleImagePixels(img) {
    if (!img || typeof img.width !== 'number' || typeof img.height !== 'number') return null;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    try {
      var canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function') return null;
      var scale = Math.min(64 / img.width, 64 / img.height, 1);
      var w = Math.max(3, Math.round(img.width * scale));
      var h = Math.max(3, Math.round(img.height * scale));
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.getImageData !== 'function') return null;
      ctx.drawImage(img, 0, 0, w, h);
      var pixels = ctx.getImageData(0, 0, w, h);
      if (!pixels || !pixels.data) return null;
      return { data: pixels.data, width: w, height: h };
    } catch (e) {
      return null;
    }
  }

  /**
   * Visual palm-vs-back-of-hand thresholds over fingertip pixel saturation.
   * Fingertip pads keep skin chroma (high saturation); fingernails do not
   * (low saturation). Saturation is (max-min)/max per pixel, so brightness
   * scaling cancels out and moderate lighting changes do not move it.
   * Calibrated on the real photos in the development environment:
   *   known back-of-hand: avg fingertip saturation 0.153-0.159, every tip <= 0.186
   *   accepted palm photos: avg 0.224-0.265, at most one tip below 0.22
   * All three conditions must hold, so one atypical fingertip (a ring glare,
   * a shadow, one blown-out pad) or an overall washed-out/monochrome photo
   * can never block an otherwise palm-like photo: below SIDE_PALM_SAT_SKIP
   * there is not enough chroma to judge at all, and the ratio condition
   * requires the fingertips to be markedly less chromatic than the palm
   * center — which is what a nail-over-pad sample actually looks like.
   */
  var SIDE_TIP_SAT_AVG_MAX = 0.19;
  var SIDE_TIP_SAT_LOW = 0.22;
  var SIDE_TIP_SAT_MIN_COUNT = 4;
  var SIDE_TIP_VS_PALM_RATIO_MAX = 0.85;
  var SIDE_PALM_SAT_SKIP = 0.1;

  /**
   * Decode the loaded image into a full-resolution RGBA buffer
   * ({ data, width, height }). Browser-only; returns null when no canvas is
   * available so non-browser callers simply skip the visual side check.
   */
  function imageFullPixels(img) {
    if (!img || typeof img.width !== 'number' || typeof img.height !== 'number') return null;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    try {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) return null;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.getImageData !== 'function') return null;
      ctx.drawImage(img, 0, 0);
      var pixels = ctx.getImageData(0, 0, w, h);
      if (!pixels || !pixels.data) return null;
      return { data: pixels.data, width: w, height: h };
    } catch (e) {
      return null;
    }
  }

  /**
   * Mean HSV saturation over a disc of full-resolution pixels centered on a
   * landmark. Pure function over an RGBA buffer — the browser path and the
   * Node test path both feed it the same shape.
   */
  function meanSatInDisc(image, cx, cy, rad) {
    var data = image.data;
    var width = image.width;
    var height = image.height;
    function satAt(x, y) {
      var i = (y * width + x) * 4;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      return mx === 0 ? 0 : (mx - mn) / mx;
    }
    var sum = 0, n = 0;
    var x0 = Math.max(1, Math.floor(cx - rad)), x1 = Math.min(width - 2, Math.ceil(cx + rad));
    var y0 = Math.max(1, Math.floor(cy - rad)), y1 = Math.min(height - 2, Math.ceil(cy + rad));
    var rr = rad * rad;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > rr) continue;
        sum += satAt(x, y);
        n++;
      }
    }
    return n ? sum / n : null;
  }

  /**
   * Sample fingertip saturation at the five fingertip landmarks
   * (thumb + four fingers), using each distal phalanx length as the disc
   * radius, plus palm-center chroma for the grayscale guard, and aggregate
   * into { tipSat, avgTipSat, lowTipCount, palmSat }. Returns null whenever
   * fewer than four fingertips could be sampled or the palm center has
   * almost no chroma — not enough signal to judge, never enough to block.
   */
  function computeSideStats(image, landmarks) {
    if (!image || !image.data || typeof image.width !== 'number' || typeof image.height !== 'number') return null;
    if (image.data.length < image.width * image.height * 4) return null;
    if (!landmarks || landmarks.length < 21) return null;

    var width = image.width, height = image.height;
    function dPx(a, b) {
      var dx = (a.x - b.x) * width, dy = (a.y - b.y) * height;
      return Math.sqrt(dx * dx + dy * dy);
    }
    var tips = [4, 8, 12, 16, 20];
    var dips = [3, 7, 11, 15, 19];
    var tipSat = [];
    for (var i = 0; i < tips.length; i++) {
      var tip = landmarks[tips[i]], dip = landmarks[dips[i]];
      if (!tip || !dip) continue;
      var rad = Math.max(12, dPx(tip, dip) * (i === 0 ? 0.55 : 0.6));
      var s = meanSatInDisc(image, tip.x * width, tip.y * height, rad);
      if (s !== null) tipSat.push(s);
    }
    if (tipSat.length < 4) return null;
    var palmC = {
      x: (landmarks[0].x + landmarks[9].x) / 2,
      y: (landmarks[0].y + landmarks[9].y) / 2
    };
    var palmRad = Math.max(12, dPx(landmarks[5], landmarks[17]) * 0.4);
    var palmSat = meanSatInDisc(image, palmC.x * width, palmC.y * height, palmRad);
    if (palmSat === null || palmSat < SIDE_PALM_SAT_SKIP) return null;
    var sum = 0, low = 0;
    for (i = 0; i < tipSat.length; i++) {
      sum += tipSat[i];
      if (tipSat[i] < SIDE_TIP_SAT_LOW) low++;
    }
    return {
      tipSat: tipSat,
      avgTipSat: sum / tipSat.length,
      lowTipCount: low,
      palmSat: palmSat
    };
  }

  /**
   * Decide from fingertip saturation stats whether the photo shows a back
   * of hand. Returns { ok, problem } with problem 'back_of_hand' for a
   * clear dorsal cluster, or ok when the stats are missing or ambiguous
   * (the check only ever blocks on strong, consistent evidence).
   */
  function assessVisualSideFromStats(stats) {
    if (!stats || typeof stats.avgTipSat !== 'number' || typeof stats.palmSat !== 'number') {
      return { ok: true, problem: null };
    }
    var tipVsPalm = stats.avgTipSat / Math.max(stats.palmSat, 0.001);
    if (stats.avgTipSat < SIDE_TIP_SAT_AVG_MAX &&
        stats.lowTipCount >= SIDE_TIP_SAT_MIN_COUNT &&
        tipVsPalm <= SIDE_TIP_VS_PALM_RATIO_MAX) {
      return { ok: false, problem: 'back_of_hand' };
    }
    return { ok: true, problem: null };
  }

  /**
   * Visual palm-vs-back-of-hand check: samples actual pixels from the
   * decoded image at the five fingertips. Landmark geometry alone cannot
   * tell palm from dorsal (validated: known back-of-hand scored 0/4 on
   * assessOrientation), so this is the pipeline's pixel-based side signal.
   * Returns { ok, problem } — never blocks when pixels are unavailable.
   */
  function assessVisualSide(img, landmarks) {
    return assessVisualSideFromStats(computeSideStats(imageFullPixels(img), landmarks));
  }

  /**
   * Server-side usability check for a palmEvidence object that already
   * passed strict shape validation. Returns a stable problem code when the
   * geometry is clearly unusable for a reading (impossible aspect ratio,
   * a palm that occupies almost none of the frame, or fingers that were
   * never extended), and null when the evidence is usable. Only clearly
   * bad values are flagged — borderline-but-valid evidence passes through
   * unchanged.
   *
   * @param {Object} evidence - a valid-shaped palmEvidence object
   * @returns {string|null} problem code, or null when usable
   */
  function assessEvidenceUsability(evidence) {
    if (!isValidPalmEvidence(evidence)) return null;
    var pb = evidence.palmBounds;
    if (pb.aspectRatio < 0.6 || pb.aspectRatio > 2) return 'aspect_ratio';
    if (pb.width < 0.04 || pb.height < 0.04) return 'palm_too_small';
    var fr = evidence.fingerRatios;
    var avg = (fr.index + fr.middle + fr.ring + fr.pinky) / 4;
    if (avg < 0.55) return 'fingers_not_extended';
    return null;
  }

   /**
    * Extracts normalized hand/palm geometry from MediaPipe Hands landmarks.
    *
    * Uses ONLY the 21 hand landmarks (no palm-line detection, no mount classification,
    * no personality extraction). Produces structured geometric evidence that is
    * tamper-evidenced downstream via signed tokens.
    *
    * MediaPipe landmark index mapping (normalized 0–1 coordinates):
    *   0   = Wrist (center of wrist line)
    *   1-4   = Thumb: CMC(1), MCP(2), IP(3), Tip(4)
    *   5-8   = Index: MCP(5), PIP(6), DIP(7), Tip(8)
    *   9-12  = Middle: MCP(9), PIP(10), DIP(11), Tip(12)
    *   13-16 = Ring: MCP(13), PIP(14), DIP(15), Tip(16)
    *   17-20 = Pinky: MCP(17), PIP(18), DIP(19), Tip(20)
    *
    * @param {Array<Object>} landmarks - 21 MediaPipe hand landmarks
    * @returns {Object|null} Structured palmEvidence or null if extraction fails
    */
   function extractGeometry(landmarks) {
     if (!landmarks || landmarks.length < 21) return null;

     var wrist = landmarks[0];
     var lm = landmarks;

     // Bounding box of all landmarks (normalized coordinates)
     var xs = [], ys = [];
     for (var i = 0; i < 21; i++) {
       xs.push(lm[i].x);
       ys.push(lm[i].y);
     }
     var minX = Math.min.apply(null, xs);
     var maxX = Math.max.apply(null, xs);
     var minY = Math.min.apply(null, ys);
     var maxY = Math.max.apply(null, ys);
     var width = maxX - minX;
     var height = maxY - minY;

     if (width <= 0 || height <= 0) return null;

     // Helper: distance between two landmarks
     function dist(a, b) {
       var dx = a.x - b.x;
       var dy = a.y - b.y;
       return Math.sqrt(dx * dx + dy * dy);
     }

     // --- FINGER EXTENSION RATIOS ---
     // For each finger, ratio of tip-to-PIP distance to MCP-to-PIP distance.
     // A value near 1 means the finger is fully extended; a lower value means curled.
     var fingers = ['index', 'middle', 'ring', 'pinky'];
     var fingerTipIdx = { index: 8, middle: 12, ring: 16, pinky: 20 };
     var fingerPipIdx = { index: 6, middle: 10, ring: 14, pinky: 18 };
     var fingerMcpIdx = { index: 5, middle: 9, ring: 13, pinky: 17 };

     var fingerRatios = {};
     fingers.forEach(function (name) {
       var tip = lm[fingerTipIdx[name]];
       var pip = lm[fingerPipIdx[name]];
       var mcp = lm[fingerMcpIdx[name]];
       var tipToPip = dist(tip, pip);
       var mcpToPip = dist(mcp, pip);
       fingerRatios[name] = mcpToPip > 0 ? tipToPip / mcpToPip : 0;
     });

     // Thumb: tip-to-IP / MCP-to-IP
     var thumbTipToIp = dist(lm[4], lm[3]);
     var thumbMcpToIp = dist(lm[2], lm[3]);
     var thumbRatio = thumbMcpToIp > 0 ? thumbTipToIp / thumbMcpToIp : 0;

     // --- PALM DIMENSIONS (relative to bounding box) ---
     var palmWidth = width;
     var palmHeight = height;

     // --- GEOMETRIC RATIOS ---
     // Ratio of index finger length to middle finger length
     var indexLength = dist(lm[5], lm[8]);
     var middleLength = dist(lm[9], lm[12]);
     var indexToMiddleRatio = middleLength > 0 ? indexLength / middleLength : 0;

     // Ratio of finger span (index MCP to pinky MCP) to palm height
     var fingerSpan = dist(lm[5], lm[17]);
     var spanToHeight = palmHeight > 0 ? fingerSpan / palmHeight : 0;

     // Thumb-to-index distance (relative)
     var thumbTipToWrist = dist(lm[4], wrist);
     var indexTipToWrist = dist(lm[8], wrist);
     var thumbToIndexRatio = indexTipToWrist > 0 ? thumbTipToWrist / indexTipToWrist : 0;

     // Hand orientation: angle of the palm (wrist to middle finger MCP)
     // This gives us a rough "facing" angle
     var dx = lm[9].x - wrist.x;
     var dy = lm[9].y - wrist.y;
     var palmAngle = Math.atan2(dy, dx) * 180 / Math.PI;

     // --- STRUCTURED EVIDENCE ---
     // This is the only evidence passed downstream. It contains purely geometric
     // measurements — NO palm-line detection, NO mount classification, NO
     // personality inference. Each observation is a string that describes one
     // measurable geometric property.
     var evidence = {
       palmBounds: {
         width: Math.round(width * 1000) / 1000,
         height: Math.round(height * 1000) / 1000,
         aspectRatio: Math.round((width / height) * 1000) / 1000
       },
       fingerRatios: {
         index: Math.round(fingerRatios.index * 1000) / 1000,
         middle: Math.round(fingerRatios.middle * 1000) / 1000,
         ring: Math.round(fingerRatios.ring * 1000) / 1000,
         pinky: Math.round(fingerRatios.pinky * 1000) / 1000,
         thumb: Math.round(thumbRatio * 1000) / 1000
       },
       geometricRatios: {
         indexToMiddle: Math.round(indexToMiddleRatio * 1000) / 1000,
         fingerSpanToHeight: Math.round(spanToHeight * 1000) / 1000,
         thumbToIndex: Math.round(thumbToIndexRatio * 1000) / 1000
       },
       palmAngle: Math.round(palmAngle * 100) / 100
     };

     return evidence;
   }

   /**
    * Strict whitelist validation for palmEvidence received server-side.
    * Ensures the evidence object has the exact shape produced by extractGeometry()
    * and contains no injection vectors (no prototype pollution, no unexpected keys).
    *
    * @param {Object|null|undefined} evidence - The evidence object to validate
    * @returns {boolean} True only if the evidence passes strict whitelist validation
    */
   function isValidPalmEvidence(evidence) {
     if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;

     var validTopKeys = ['palmBounds', 'fingerRatios', 'geometricRatios', 'palmAngle'];
     var keys = Object.keys(evidence);
     for (var i = 0; i < keys.length; i++) {
       if (validTopKeys.indexOf(keys[i]) === -1) return false;
     }

     // palmBounds: width, height, aspectRatio — all finite numbers in [0, 2]
     var pb = evidence.palmBounds;
     if (!pb || typeof pb !== 'object' || Array.isArray(pb)) return false;
     var pbNumKeys = ['width', 'height', 'aspectRatio'];
     for (var j = 0; j < pbNumKeys.length; j++) {
       var v = pb[pbNumKeys[j]];
       if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 2) return false;
     }
     var pbKeys = Object.keys(pb);
     for (var j2 = 0; j2 < pbKeys.length; j2++) {
       if (pbNumKeys.indexOf(pbKeys[j2]) === -1) return false;
     }

     // fingerRatios: thumb + 4 fingers — all finite numbers in [0, 2]
     var fr = evidence.fingerRatios;
     if (!fr || typeof fr !== 'object' || Array.isArray(fr)) return false;
     var frKeys = ['index', 'middle', 'ring', 'pinky', 'thumb'];
     for (var k = 0; k < frKeys.length; k++) {
       var fv = fr[frKeys[k]];
       if (typeof fv !== 'number' || !isFinite(fv) || fv < 0 || fv > 2) return false;
     }
     var frActualKeys = Object.keys(fr);
     for (var k2 = 0; k2 < frActualKeys.length; k2++) {
       if (frKeys.indexOf(frActualKeys[k2]) === -1) return false;
     }

     // geometricRatios: 3 keys — all finite numbers in [0, 5]
     var gr = evidence.geometricRatios;
     if (!gr || typeof gr !== 'object' || Array.isArray(gr)) return false;
     var grKeys = ['indexToMiddle', 'fingerSpanToHeight', 'thumbToIndex'];
     for (var m = 0; m < grKeys.length; m++) {
       var gv = gr[grKeys[m]];
       if (typeof gv !== 'number' || !isFinite(gv) || gv < 0 || gv > 5) return false;
     }
     var grActualKeys = Object.keys(gr);
     for (var m2 = 0; m2 < grActualKeys.length; m2++) {
       if (grKeys.indexOf(grActualKeys[m2]) === -1) return false;
     }

     // palmAngle: finite number in [-180, 180]
     if (typeof evidence.palmAngle !== 'number' || !isFinite(evidence.palmAngle) || evidence.palmAngle < -180 || evidence.palmAngle > 180) return false;

     return true;
   }

   /**
    * Validates a user-selected image File object.
    *
    * @param {File} file - The image file from the file input.
    * @returns {Promise<Object>} - Resolves with { valid, handCount, quality, palmFacing, palmEvidence }.
    *   Rejects with an Error whose message is a user-facing reason.
    */
   function validateImage(file) {
     return loadModel().then(function () {
       if (validating) {
         return Promise.reject(new Error('Please wait for the current image to finish validating.'));
       }
       validating = true;
       return new Promise(function (resolve, reject) {
         // 1. File type
         if (!file || !file.type || !file.type.startsWith('image/')) {
           validating = false;
           reject(new Error('Please choose an image file of your hand.'));
           return;
         }

         // 2. File size
         if (file.size > MAX_FILE_SIZE) {
           validating = false;
           reject(new Error('Image is too large. Please choose a file under 10 MB.'));
           return;
         }

         // 3. Load image element
         var img = new Image();
         var objectUrl = URL.createObjectURL(file);

         img.onload = function () {
           URL.revokeObjectURL(objectUrl);

            // 4. Dimensions
            if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) {
              validating = false;
              reject(new Error('Image is too small. Please upload a larger photo of your palm.'));
              return;
            }

            // 5. Photo quality: brightness, contrast, focus
            var quality = analyzeImageQuality(sampleImagePixels(img));
            if (quality && quality.problem) {
              validating = false;
              var qualityError = new Error(getPhotoRequestMessage('quality'));
              qualityError.problem = quality.problem;
              reject(qualityError);
              return;
            }

            // 6. Hand detection
            var settled = false;

           handsInstance.onResults(function (results) {
             if (settled) return;
             settled = true;

             var handCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

             if (handCount === 0) {
               validating = false;
               reject(new Error('No hand detected. Please upload a clear photo of your palm.'));
               return;
             }

             if (handCount > 1) {
               validating = false;
               reject(new Error('Multiple hands detected. Please upload one palm only.'));
               return;
             }

             var landmarks = results.multiHandLandmarks[0];

              // 7. Open palm check
              if (!isHandOpen(landmarks)) {
                validating = false;
                reject(new Error('Please show your open palm. Keep your fingers spread for a clear photo.'));
                return;
              }

               // 8. Visual side check: actual fingertip pixels distinguish
               //    palm-facing from back-of-hand. Runs before framing checks
               //    so a dorsal photo is rejected as back_of_hand even when it
               //    is well lit, open, and fully inside the frame.
               var sideCheck = assessVisualSide(img, landmarks);
               if (sideCheck && !sideCheck.ok) {
                 validating = false;
                 var sideError = new Error(getPhotoRequestMessage('palm'));
                 sideError.problem = sideCheck.problem;
                 reject(sideError);
                 return;
               }

               // 9. Palm usability: crop, spread, orientation
               var usability = assessPalmUsability(landmarks);
               if (!usability.ok) {
                 validating = false;
                 var usabilityError = new Error(getPhotoRequestMessage('palm'));
                 usabilityError.problem = usability.problem;
                 reject(usabilityError);
                 return;
               }

               // 10. Palm-facing heuristic (recorded in the result payload)
               var palmFacing = isPalmFacing(landmarks);

               // 11. Extract normalized geometry for downstream evidence
               var palmEvidence = extractGeometry(landmarks);

             validating = false;
             resolve({
               valid: true,
               handCount: handCount,
               quality: 'good',
               palmFacing: palmFacing,
               palmEvidence: palmEvidence
             });
           });

           handsInstance.send({ image: img }).catch(function () {
             if (settled) return;
             settled = true;
             validating = false;
             reject(new Error('Could not analyze image. Please try again.'));
           });
         };

         img.onerror = function () {
           URL.revokeObjectURL(objectUrl);
           validating = false;
           reject(new Error('Could not load image. Please try another file.'));
         };

         img.src = objectUrl;
       });
     }).catch(function (err) {
       validating = false;
       throw err;
     });
   }

   function isReady() {
     return modelReady;
   }

  return {
    validateImage: validateImage,
    isReady: isReady,
    load: loadModel,
    extractGeometry: extractGeometry,
    isValidPalmEvidence: isValidPalmEvidence,
    getPhotoRequestMessage: getPhotoRequestMessage,
    assessPalmUsability: assessPalmUsability,
    assessEvidenceUsability: assessEvidenceUsability,
    assessOrientation: assessOrientation,
    assessVisualSide: assessVisualSide,
    computeSideStats: computeSideStats,
    assessVisualSideFromStats: assessVisualSideFromStats,
    analyzeImageQuality: analyzeImageQuality
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PalmValidator;
}
