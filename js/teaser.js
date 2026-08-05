/**
 * PalmPyaar teaser — DOB → sign, photo → SHA-256 hash, seed → one free line.
 * Photo is hashed client-side only; the raw image is never uploaded.
 */
(function () {
  'use strict';

  var SIGNS = [
    { name: 'Capricorn', start: [12, 22], end: [1, 19] },
    { name: 'Aquarius', start: [1, 20], end: [2, 18] },
    { name: 'Pisces', start: [2, 19], end: [3, 20] },
    { name: 'Aries', start: [3, 21], end: [4, 19] },
    { name: 'Taurus', start: [4, 20], end: [5, 20] },
    { name: 'Gemini', start: [5, 21], end: [6, 20] },
    { name: 'Cancer', start: [6, 21], end: [7, 22] },
    { name: 'Leo', start: [7, 23], end: [8, 22] },
    { name: 'Virgo', start: [8, 23], end: [9, 22] },
    { name: 'Libra', start: [9, 23], end: [10, 22] },
    { name: 'Scorpio', start: [10, 23], end: [11, 21] },
    { name: 'Sagittarius', start: [11, 22], end: [12, 21] }
  ];

  var form = null;
  var teaserSection = null;
  var teaserFlow = null;
  var teaserText = null;
  var teaserSign = null;
  var unlockBtn = null;
  var photoStatus = null;
  var photoLabelText = null;
  var currentPhotoHash = '';

  function getZodiacSign(month, day) {
    if (!month || !day) return null;

    for (var i = 0; i < SIGNS.length; i++) {
      var sign = SIGNS[i];
      var sm = sign.start[0];
      var sd = sign.start[1];
      var em = sign.end[0];
      var ed = sign.end[1];

      if (sm === em) {
        if (month === sm && day >= sd && day <= ed) return sign.name;
      } else if (sm > em) {
        if ((month === sm && day >= sd) || (month === em && day <= ed)) return sign.name;
      } else {
        if ((month === sm && day >= sd) || (month === em && day <= ed) ||
            (month > sm && month < em)) return sign.name;
      }
    }
    return null;
  }

  function signFromDob(dob) {
    if (!dob) return null;
    var parts = dob.split('-');
    if (parts.length !== 3) return null;
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    if (isNaN(month) || isNaN(day)) return null;
    return getZodiacSign(month, day);
  }

  function getTradition() {
    if (!form) return 'western';
    var selected = form.querySelector('input[name="tradition"]:checked');
    return selected ? selected.value : 'western';
  }

  function hashPhoto(file) {
    return file.arrayBuffer().then(function (buffer) {
      return crypto.subtle.digest('SHA-256', buffer);
    }).then(function (hashBuffer) {
      var bytes = new Uint8Array(hashBuffer);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return hex;
    });
  }

  function computeSeed(sign, photoHash) {
    var input = sign + '|' + (photoHash || 'none');
    var encoder = new TextEncoder();
    return crypto.subtle.digest('SHA-256', encoder.encode(input)).then(function (buf) {
      var view = new DataView(buf);
      return view.getUint32(0, false);
    });
  }

  function setPhotoStatus(message, state) {
    if (!photoStatus) return;
    photoStatus.textContent = message;
    photoStatus.dataset.state = state || '';
  }

  function setTeaserFlowVisible(visible) {
    if (!teaserFlow) return;
    if (visible) {
      teaserFlow.removeAttribute('aria-hidden');
      teaserFlow.classList.add('is-visible');
    } else {
      teaserFlow.setAttribute('aria-hidden', 'true');
      teaserFlow.classList.remove('is-visible');
    }
  }

  function showTeaser(sign, line, tradition) {
    if (!teaserSection || !teaserText || !teaserSign) return;

    var traditionLabel = {
      western: 'Western',
      vedic: 'Vedic',
      hellenic: 'Hellenic'
    };

    setTeaserFlowVisible(false);
    teaserSign.textContent = sign + ' · ' + (traditionLabel[tradition] || 'Western');
    teaserText.textContent = line;
    teaserSection.hidden = false;
    teaserSection.setAttribute('aria-live', 'polite');

    requestAnimationFrame(function () {
      teaserSection.classList.add('is-visible');
    });

    if (unlockBtn) {
      unlockBtn.disabled = false;
      unlockBtn.setAttribute('aria-disabled', 'false');
    }
  }

  function hideTeaser() {
    if (!teaserSection) return;
    teaserSection.classList.remove('is-visible');
    teaserSection.hidden = true;
    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.setAttribute('aria-disabled', 'true');
    }
  }

  function updateTeaserFlow(dob) {
    var sign = signFromDob(dob);
    if (sign && teaserSection && teaserSection.hidden) {
      setTeaserFlowVisible(true);
    } else if (!sign) {
      setTeaserFlowVisible(false);
    }
  }

  function updateTeaser() {
    if (!form) return;

    var dob = form.dob.value;
    var tradition = getTradition();
    var sign = signFromDob(dob);

    updateTeaserFlow(dob);

    if (!sign) {
      hideTeaser();
      return;
    }

    computeSeed(sign, currentPhotoHash).then(function (seed) {
      if (!window.PalmTemplates) return;
      var line = window.PalmTemplates.getTeaserLine(sign, tradition, seed);
      showTeaser(sign, line, tradition);
    });
  }

  function onPhotoChange(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      currentPhotoHash = '';
      setPhotoStatus('Optional — hashed on your device, never uploaded.', 'idle');
      if (photoLabelText) photoLabelText.textContent = 'Add a photo';
      updateTeaser();
      return;
    }

    if (!file.type.startsWith('image/')) {
      event.target.value = '';
      currentPhotoHash = '';
      setPhotoStatus('Please choose an image file.', 'error');
      if (photoLabelText) photoLabelText.textContent = 'Add a photo';
      updateTeaser();
      return;
    }

    setPhotoStatus('Hashing on your device…', 'loading');
    if (photoLabelText) photoLabelText.textContent = file.name;

    hashPhoto(file).then(function (hash) {
      currentPhotoHash = hash;
      setPhotoStatus('Photo hashed locally — never uploaded.', 'success');
      updateTeaser();
    }).catch(function () {
      currentPhotoHash = '';
      setPhotoStatus('Could not hash photo. Try another image.', 'error');
      if (photoLabelText) photoLabelText.textContent = 'Add a photo';
      updateTeaser();
    });
  }

  function onUnlockClick(event) {
    event.preventDefault();
    if (window.PalmCheckout && typeof window.PalmCheckout.startCheckout === 'function') {
      window.PalmCheckout.startCheckout();
    }
  }

  function initSignatureDraw() {
    var path = document.querySelector('.signature-path');
    if (!path) return;

    var length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      path.style.strokeDashoffset = '0';
      path.classList.add('is-drawn');
      return;
    }

    requestAnimationFrame(function () {
      path.classList.add('is-drawn');
    });
  }

  function initPageReveal() {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      document.body.classList.add('is-ready');
      return;
    }
    requestAnimationFrame(function () {
      document.body.classList.add('is-ready');
    });
  }

  function init() {
    form = document.getElementById('reading-form');
    teaserSection = document.getElementById('teaser-reveal');
    teaserFlow = document.getElementById('teaser-flow');
    teaserText = document.getElementById('teaser-line');
    teaserSign = document.getElementById('teaser-sign');
    unlockBtn = document.getElementById('unlock-btn');
    photoStatus = document.getElementById('photo-status');
    photoLabelText = document.querySelector('.photo-upload__text');

    if (!form) return;

    form.addEventListener('input', updateTeaser);
    form.addEventListener('change', updateTeaser);

    var photoInput = form.querySelector('#photo');
    if (photoInput) {
      photoInput.addEventListener('change', onPhotoChange);
    }

    if (unlockBtn) {
      unlockBtn.addEventListener('click', onUnlockClick);
    }

    initSignatureDraw();
    initPageReveal();
    updateTeaser();
  }

  window.PalmTeaser = {
    getPhotoHash: function () {
      return currentPhotoHash;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

