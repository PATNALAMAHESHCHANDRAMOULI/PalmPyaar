/**
 * PalmPyaar reveal — result page controller
 * Displays loading state and calls /api/generate-reading to let the server
 * perform token verification using TOKEN_SECRET.
 * Displays reading only on successful server response; shows Access Denied on failure.
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
    { name: 'Scorpio', start: [10, 23], end: [11, 21] },
    { name: 'Sagittarius', start: [11, 22], end: [12, 21] }
  ];

  function getZodiacSign(dob) {
    if (!dob) return 'Zodiac Sign';
    var parts = dob.split('-');
    if (parts.length !== 3) return 'Zodiac Sign';
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d)) return 'Zodiac Sign';

    for (var i = 0; i < SIGNS.length; i++) {
      var sign = SIGNS[i];
      var sm = sign.start[0], sd = sign.start[1];
      var em = sign.end[0], ed = sign.end[1];
      if (sm === em && m === sm && d >= sd && d <= ed) return sign.name;
      if (sm > em && ((m === sm && d >= sd) || (m === em && d <= ed))) return sign.name;
      if (sm < em && ((m === sm && d >= sd) || (m === em && d <= ed) || (m > sm && m < em))) return sign.name;
    }
    return 'Zodiac Sign';
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getPlaceholderData(name, dob, birthplace, tradition) {
    var sign = getZodiacSign(dob);
    var tradName = capitalize(tradition) || 'Western';

    return {
      core: '<p class="reading-paragraph">Your birth configuration in <strong>' + birthplace + '</strong> under the <strong>' + tradName + '</strong> tradition highlights a natural harmony between your intuitive core and your driven expression. As a <strong>' + sign + '</strong>, your profile suggests a reflective temperament that values authenticity over surface.</p>' +
            '<p class="reading-paragraph">You often notice details others overlook, giving you an understated advantage in long-term endeavors. The pattern here is not repetition for its own sake — it is depth that accumulates quietly over time.</p>',

      love: '<p class="reading-paragraph">In personal connections, your energy seeks authenticity and mutual intellectual respect over fleeting excitement. You tend to observe before revealing yourself, which can make your trust feel like a quiet gift once given.</p>' +
            '<p class="reading-paragraph">Light relationship note: Upcoming months favor clear, honest conversations that bring renewed warmth and mutual understanding to your closest bonds.</p>',

      pro: '<p class="reading-paragraph">Focus on steady personal growth and creative pursuits; clarity arrives as you align with your own rhythm rather than external expectations.</p>' +
            '<p class="reading-paragraph">Your dasha period emphasizes patience in career milestones while fostering inner balance and spiritual harmony.</p>' +
            '<p class="reading-paragraph">The essential dignity of your ruling planet favors strategic choices made during the upcoming lunar cycle.</p>' +
            '<p class="reading-paragraph">Q1 & Q2 center on laying strong foundations and organizing key goals. Q3 brings opportunities for expanding social and professional circles. Q4 brings a sense of deep personal completion and fulfillment.</p>'
    };
  }

  function renderReading(name, dob, birthplace, tradition, readingData) {
    var titleEl = document.getElementById('reading-user-name');
    var metaEl = document.getElementById('reading-meta');
    var coreEl = document.getElementById('section-core');
    var loveEl = document.getElementById('section-love');
    var proEl = document.getElementById('section-pro');
    var shareBtn = document.getElementById('share-whatsapp-btn');

    var sign = getZodiacSign(dob);
    var tradName = capitalize(tradition) || 'Western';

    if (titleEl) titleEl.textContent = name + '’s Personalized Reading';
    if (metaEl) {
      metaEl.textContent = sign + ' · ' + tradName + ' Tradition · Born in ' + birthplace;
    }

    if (coreEl) coreEl.innerHTML = readingData.core || '';
    if (loveEl) loveEl.innerHTML = readingData.love || '';
    if (proEl) proEl.innerHTML = readingData.pro || '';

    if (shareBtn) {
      var shareText = 'Check out my personalized PalmPyaar reading for ' + name + ' (' + sign + '): ' + window.location.href;
      shareBtn.href = 'https://wa.me/?text=' + encodeURIComponent(shareText);
    }
  }

  function init() {
    var loadingEl = document.getElementById('reveal-loading');
    var deniedEl = document.getElementById('reveal-denied');
    var contentEl = document.getElementById('reveal-content');
    var loadingTitle = document.getElementById('loading-title');

    var params = new URLSearchParams(window.location.search);
    var name = params.get('name') || 'Friend';
    var dob = params.get('dob') || '';
    var birthTime = params.get('birthTime') || '';
    var birthplace = params.get('birthplace') || 'Earth';
    var tradition = params.get('tradition') || 'western';

    // Step 1: Display loading state
    if (loadingEl) loadingEl.hidden = false;
    if (contentEl) contentEl.hidden = true;
    if (deniedEl) deniedEl.hidden = true;

    if (loadingTitle) {
      loadingTitle.textContent = 'Aligning reading for ' + name + '…';
    }

    // Step 2: Call /api/generate-reading so server verifies TOKEN_SECRET HMAC
    var fetchUrl = '/api/generate-reading' + window.location.search;

    fetch(fetchUrl)
      .then(function (res) {
        // Step 3: Let server verify token. Non-200 means server token verification failed
        if (!res.ok) {
          throw new Error('Server token verification failed');
        }
        return res.json();
      })
      .then(function (data) {
        console.log("SERVER RESPONSE:", data);
        console.log("loadingEl:", loadingEl);
        console.log("contentEl:", contentEl);
        console.log("section-core:", document.getElementById("section-core"));
        console.log("section-love:", document.getElementById("section-love"));
        console.log("section-pro:", document.getElementById("section-pro"));
         // Step 4: Display reading data ONLY after a successful server response
         if (data && data.success) {
           var readingData = data.reading || getPlaceholderData(name, dob, birthplace, tradition);
           console.log("About to render reading...");
           renderReading(name, dob, birthplace, tradition, readingData);
           console.log("Render completed.");

           // Show astrology section if birthTime or birthplace is available
           var astroSection = document.getElementById('astrology-section');
           var astroContent = document.getElementById('astrology-content');
           if (astroSection && astroContent) {
             if (data.astrologyData) {
               astroContent.innerHTML = formatAstrologyForDisplay(data.astrologyData, tradition);
               astroSection.hidden = false;
             } else {
               astroSection.hidden = true;
             }
           }

           // Enable questions section after payment-vered reading is displayed
           var questionsSection = document.getElementById('questions-section');
           if (questionsSection) {
             questionsSection.hidden = false;
             // Enable the question form (questions.js will initialize the form)
             var qInput = document.getElementById('question-input');
             var qSubmit = document.getElementById('question-submit');
             if (qInput) qInput.disabled = false;
             if (qSubmit) {
               qSubmit.disabled = false;
               qSubmit.setAttribute('aria-disabled', 'false');
             }
           }

           if (loadingEl) loadingEl.hidden = true;
           if (contentEl) {
             contentEl.hidden = false;
             contentEl.classList.add('is-visible');
           }
         } else {
          throw new Error('Invalid token response');
        }
      })
      .catch(function (err) {
        console.error("REVEAL ERROR:", err);
        // Step 5: If verification fails, show the Access Denied screen
        if (loadingEl) loadingEl.hidden = true;
        if (contentEl) contentEl.hidden = true;
        if (deniedEl) deniedEl.hidden = false;
      });
  }

  function formatAstrologyForDisplay(astroData, tradition) {
    if (!astroData || typeof astroData !== 'object') return '';

    var meta = astroData.meta || {};
    var signs = astroData.signs || {};
    var asc = astroData.ascendant || {};
    var mc = astroData.midheaven || {};
    var vedic = astroData.vedic || {};
    var hellenistic = astroData.hellenistic || {};

    function fmtPos(pos) {
      if (!pos || !pos.sign) return 'unspecified';
      return pos.sign + ' ' + pos.degrees + '\u00b0' + (pos.minutes || 0) + "'";
    }

    var html = '<div class="astrology-display">';

    // Ascendant
    if (asc.sidereal && asc.sidereal.sign) {
      html += '<div class="astro-card"><div class="astro-card__title">Lagna (Rising)</div><div class="astro-card__content">' + fmtPos(asc.sidereal) + '</div></div>';
    }

    // Sun & Moon
    if (signs.sun) {
      html += '<div class="astro-card"><div class="astro-card__title">Sun</div><div class="astro-card__content">' + fmtPos(signs.sun.sidereal) + '</div></div>';
    }
    if (signs.moon) {
      html += '<div class="astro-card"><div class="astro-card__title">Moon</div><div class="astro-card__content">' + fmtPos(signs.moon.sidereal) + '</div></div>';
    }

    // MC
    if (mc.sidereal && mc.sidereal.sign) {
      html += '<div class="astro-card"><div class="astro-card__title">Midheaven</div><div class="astro-card__content">' + fmtPos(mc.sidereal) + '</div></div>';
    }

    // Vedic specifics
    if (tradition === 'vedic') {
      if (vedic.nakshatra && vedic.nakshatra.name) {
        html += '<div class="astro-card"><div class="astro-card__title">Nakshatra</div><div class="astro-card__content">' + vedic.nakshatra.name + ' (Pada ' + (vedic.nakshatra.pada || '?') + ')</div></div>';
      }
      if (vedic.rashi && vedic.rashi.sign) {
        html += '<div class="astro-card"><div class="astro-card__title">Rashi (Moon sign)</div><div class="astro-card__content">' + vedic.rashi.sign + ' ' + vedic.rashi.degrees + '\u00b0</div></div>';
      }
      if (vedic.dasha && vedic.dasha.mahaDasha) {
        html += '<div class="astro-card"><div class="astro-card__title">Dasha</div><div class="astro-card__content">' + vedic.dasha.mahaDasha.lord + ' (' + (vedic.dasha.mahaDasha.balanceYears || 0) + ' yrs balance)</div></div>';
      }
    }

    // Hellenistic specifics
    if (tradition === 'hellenic') {
      if (hellenistic.lots && hellenistic.lots.fortune) {
        html += '<div class="astro-card"><div class="astro-card__title">Lot of Fortune</div><div class="astro-card__content">' + fmtPos(hellenistic.lots.fortune) + '</div></div>';
      }
      if (hellenistic.sect) {
        html += '<div class="astro-card"><div class="astro-card__title">Sect</div><div class="astro-card__content">' + hellenistic.sect + '</div></div>';
      }
    }

    // Planetary summary
    if (astroData.planets) {
      var PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];
      var planetParts = [];
      for (var i = 0; i < PLANET_NAMES.length; i++) {
        var pname = PLANET_NAMES[i];
        var p = astroData.planets[pname];
        if (p && p.sidereal && p.sidereal.sign) {
          planetParts.push('<span class="astro-planet">' + pname + ': ' + p.sidereal.sign + ' ' + p.sidereal.degrees + '\u00b0</span>');
        }
      }
      if (planetParts.length > 0) {
        html += '<div class="astro-planets">' + planetParts.join(' ') + '</div>';
      }
    }

    // Coordinates
    if (meta.resolved) {
      html += '<p class="astro-meta">Coordinates: ' + meta.coordinates.lat.toFixed(2) + '\u00b0, ' + meta.coordinates.lng.toFixed(2) + '\u00b0 \u00b7 ' + meta.timezone + '</p>';
    }

    html += '</div>';
    return html;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init();
      initPageReveal();
    });
  } else {
    init();
    initPageReveal();
  }
})();
