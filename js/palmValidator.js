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
 *
 * The raw image stays in the browser — it is never uploaded to any service.
 * Only a SHA-256 hash is ever sent to the server (handled by teaser.js).
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
   * Validate a user-selected image File object.
   *
   * @param {File} file - The image file from the file input.
   * @returns {Promise<Object>} - Resolves with { valid, handCount, quality, palmFacing }.
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

            validating = false;
            resolve({
              valid: true,
              handCount: handCount,
              quality: 'good',
              palmFacing: palmFacing
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
    load: loadModel
  };
})();
