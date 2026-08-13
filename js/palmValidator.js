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
   *   5. Run MediaPipe Hands detection (minDetectionConfidence 0.5 enforced by MediaPipe options)
   *   6. Require exactly one hand
   *   7. Geometric check: fingers should be extended (open palm, not a fist)
   *   8. Extract normalized geometry (palmBounds, fingerRatios, geometricRatios, palmAngle)
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

           // 5. Hand detection
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

             // 6. Open palm check
             if (!isHandOpen(landmarks)) {
               validating = false;
               reject(new Error('Please show your open palm. Keep your fingers spread for a clear photo.'));
               return;
             }

             // 7. Palm-facing heuristic (non-blocking — logged for future use)
             var palmFacing = isPalmFacing(landmarks);

             // 8. Extract normalized geometry for downstream evidence
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
    isValidPalmEvidence: isValidPalmEvidence
  };
})();
