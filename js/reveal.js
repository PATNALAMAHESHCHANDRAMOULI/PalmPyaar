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
      core: '<p class="reading-paragraph">Your birth configuration in <strong>' + birthplace + '</strong> under the <strong>' + tradName + '</strong> tradition highlights a natural harmony between your intuitive core and your driven expression. As a <strong>' + sign + '</strong>, your palm signature indicates high resilience and reflective depth.</p>' +
            '<p class="reading-paragraph">The subtle curves of your headline suggest a mind that processes experiences thoroughly before taking decisive action. You often notice details others overlook, giving you an understated advantage in long-term endeavors.</p>',

      love: '<p class="reading-paragraph">In personal connections, your energy seeks authenticity and mutual intellectual respect over fleeting excitement. Your palm\'s heart line trajectory shows a deep capacity for empathy paired with clear personal boundaries.</p>' +
            '<blockquote class="reading-quote">"True synergy occurs when your grounded nature aligns with a partner who values quiet constancy."</blockquote>' +
            '<p class="reading-paragraph">Light relationship note: Upcoming months favor clear, honest conversations that bring renewed warmth and mutual understanding to your closest bonds.</p>',

      pro: '<div class="pro-grid">' +
            '  <div class="pro-card">' +
            '    <h3 class="pro-card__title">Western Verdict</h3>' +
            '    <p class="pro-card__text">Focus on steady personal growth and creative pursuits; clarity arrives as Saturn aligns with your focal solar house.</p>' +
            '  </div>' +
            '  <div class="pro-card">' +
            '    <h3 class="pro-card__title">Vedic Insight</h3>' +
            '    <p class="pro-card__text">Your dasha period emphasizes patience in career milestones while fostering inner balance and spiritual harmony.</p>' +
            '  </div>' +
            '  <div class="pro-card">' +
            '    <h3 class="pro-card__title">Hellenic Arc</h3>' +
            '    <p class="pro-card__text">The essential dignity of your ruling planet favors strategic choices made during the upcoming lunar cycle.</p>' +
            '  </div>' +
            '</div>' +
            '<div class="outlook-box">' +
            '  <h3 class="outlook-box__title">12-Month Outlook</h3>' +
            '  <p class="outlook-box__text">Q1 & Q2 center on laying strong foundations and organizing key goals. Q3 brings opportunities for expanding social and professional circles. Q4 brings a sense of deep personal completion and fulfillment.</p>' +
            '</div>'
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
        // Step 4: Display reading data ONLY after a successful server response
        if (data && data.success) {
          var readingData = data.reading || getPlaceholderData(name, dob, birthplace, tradition);
          renderReading(name, dob, birthplace, tradition, readingData);

          if (loadingEl) loadingEl.hidden = true;
          if (contentEl) {
            contentEl.hidden = false;
            contentEl.classList.add('is-visible');
          }
        } else {
          throw new Error('Invalid token response');
        }
      })
      .catch(function () {
        // Step 5: If verification fails, show the Access Denied screen
        if (loadingEl) loadingEl.hidden = true;
        if (contentEl) contentEl.hidden = true;
        if (deniedEl) deniedEl.hidden = false;
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
