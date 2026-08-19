/**
 * PalmPyaar Moment — social sharing card
 *
 * After the user has used up their available follow-up questions, this module
 * generates a premium 9:16 shareable card ("Your PalmPyaar Moment") containing
 * exactly two concise, reflective, non-astrological sentences derived from the
 * themes of the questions they asked. The card is rendered client-side with
 * Canvas2D (no external dependency), using the existing PalmPyaar visual
 * identity (night/gold/rose palette, Fraunces + Manrope type, signature-curve
 * motif and gold star).
 *
 * Sharing never touches a social API. Where the browser supports the native
 * Web Share API with files, the user invokes their device share sheet;
 * otherwise the card downloads as a PNG. PalmPyaar never posts anywhere and
 * never asks for social credentials.
 *
 * The pure text/markup/share-decision logic is Node-testable; the Canvas
 * renderer is browser-only and guarded.
 */
(function () {
  'use strict';

  var BRAND = 'PalmPyaar';
  var HEADING = 'YOUR PALMPYAAR MOMENT';
  var SIGNATURE = 'PalmPyaar · Made for your reflection';
  var FILENAME = 'palmpyaar-moment.png';
  var CARD_WIDTH = 1080;
  var CARD_HEIGHT = 1920;

  var BANNED_PHRASES = [
    'you are destined for greatness',
    'believe in yourself',
    'the universe has a plan',
    'great things are coming',
    'you are stronger than you think',
    'your journey is unique',
    'never give up'
  ];

  var JARGON = [
    'astrology', 'astrologer', 'planet', 'planets', 'zodiac', 'mahadasha',
    'nakshatra', 'nakshatras', 'horoscope', 'birth chart', 'constellation',
    'retrograde', 'dasha', 'palmistry', 'prediction', 'predictive', 'sun sign',
    'moon sign', 'houses', 'house', 'stars', 'ai', 'dataset', 'model',
    'algorithm', 'prediction engine'
  ];

  // Theme order matters: more specific themes are matched first. Each theme
  // carries 2 hand-written two-sentence pairs (professional reflective copy,
  // never astrological, never predictive, no fabricated claims).
  var THEME_ORDER = [
    {
      key: 'career',
      match: /\b(job|career|work|promotion|office|employ|interview|business|salary|income|finance|money|profession|lucrative)/i,
      lines: [
        ['Your careful work is moving even when it is not loud yet.', 'The right doors tend to open once the foundation is finished.'],
        ['You are building something that fits your own standards, not someone else\'s.', 'That always takes a little longer, and it is worth it.']
      ]
    },
    {
      key: 'relationships',
      match: /\b(marri|relationship|partner|love|wedding|husband|wife|boyfriend|girlfriend|breakup|together|crush)/i,
      lines: [
        ['The bond you are tending will deepen at its own pace.', 'What is honest rarely needs to be rushed.'],
        ['Some of the most meaningful connections grow slowly and quietly.', 'Let them find their rhythm instead of forcing one.']
      ]
    },
    {
      key: 'newBeginnings',
      match: /\b(move|relocat|abroad|start fresh|beginn|began|begun|fresh start|shift city|new place|travel)/i,
      lines: [
        ['An ending is often just a doorway facing the other way.', 'You have already begun what comes next.'],
        ['The new chapter will not look like the old one.', 'That is the point, and you are ready for it.']
      ]
    },
    {
      key: 'change',
      match: /\b(change|transition|uncertain|direction|path|next step|turn)/i,
      lines: [
        ['Change is not proof that you were wrong.', 'It is proof that you are willing to keep becoming yourself.'],
        ['Letting go of an old shape is the start of taking a new one.', 'You are not starting over — you are starting forward.']
      ]
    },
    {
      key: 'ambition',
      match: /\b(ambition|dream|goal|aspire|achieve|succeed|success|accomplish)/i,
      lines: [
        ['You want something real, and that wanting is a signal, not a flaw.', 'Keep it close and let it guide your next step.'],
        ['The ambition you carry is a quiet engine.', 'It moves you forward even on the days the road is unclear.']
      ]
    },
    {
      key: 'confidence',
      match: /\b(confiden|self-esteem|fear|afraid|doubt|shy|bold|assertive|courage)/i,
      lines: [
        ['You already know more than you give yourself credit for.', 'Trusting that quiet inner voice is what changes things.'],
        ['The version of you that feels sure is not far away.', 'It is built one small honest choice at a time.']
      ]
    },
    {
      key: 'resilience',
      match: /\b(difficult|hard time|struggle|hardship|overcome|strong|tough|challenge|obstacle|pain)/i,
      lines: [
        ['You have kept going through things that were not easy.', 'That durability is the quietest and most real kind of strength.'],
        ['A rough patch is not your whole story.', 'It is the part of the story where you learned to hold steady.']
      ]
    },
    {
      key: 'growth',
      match: /\b(grow|growth|learn|improve|develop|become better|mature|evolve)/i,
      lines: [
        ['You are not the same person who began this season.', 'The change is subtle, but it is real and it is yours.'],
        ['Growth rarely announces itself while it is happening.', 'It shows up later, in how much lighter you feel.']
      ]
    },
    {
      key: 'opportunity',
      match: /\b(opportunit|chance|offer|opening|potential)/i,
      lines: [
        ['What is being offered to you is not a coincidence.', 'It is the next step you have quietly been preparing for.'],
        ['Opportunity often looks ordinary at first.', 'Pay attention to the door that opens softly, without announcing itself.']
      ]
    },
    {
      key: 'independence',
      match: /\b(independen|alone|solo|self-reliant|on my own|by myself)/i,
      lines: [
        ['Your life feels steadier in your own hands than you once believed.', 'Choosing yourself is not selfish; it is honest.'],
        ['Walking your own path takes more courage than following the crowd.', 'The strength is already in how you keep choosing it.']
      ]
    },
    {
      key: 'self-discovery',
      match: /\b(self|who am i|purpose|meaning|identit|know myself|discover)/i,
      lines: [
        ['The person you are becoming is not a stranger to you.', 'They are simply someone you have not introduced yourself to yet.'],
        ['Answers about yourself rarely arrive all at once.', 'They arrive in the honest questions you are willing to sit with.']
      ]
    },
    {
      key: 'patience',
      match: /\b(wait|patient|slow|when will|soon|timing|season)/i,
      lines: [
        ['Some answers arrive after the waiting, not instead of it.', 'Let the unfinished be allowed to finish in its own time.'],
        ['A quiet season is still a season of work.', 'The roots grow deepest when nothing visible is happening above.']
      ]
    },
    {
      key: 'reflection',
      match: /(?:)/,
      lines: [
        ['Not everything that matters needs to be loud.', 'Some of the most lasting things arrive almost unnoticed.'],
        ['You are exactly where a thoughtful person would be.', 'Still learning, still paying attention, still becoming.']
      ]
    }
  ];

  var THEMES = {};
  for (var t = 0; t < THEME_ORDER.length; t++) {
    THEMES[THEME_ORDER[t].key] = { lines: THEME_ORDER[t].lines };
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return escapeHtml(String(str));
  }

  function normalizeQuestions(questions) {
    if (!Array.isArray(questions)) return [];
    return questions
      .map(function (q) {
        if (typeof q === 'string') return q;
        if (q && typeof q === 'object') return q.question || q.text || q.q || '';
        return '';
      })
      .map(function (s) { return String(s).trim(); })
      .filter(Boolean);
  }

  /**
   * Pick the strongest theme from the user's question context.
   * @param {Array} questions - array of strings or {question}/{text} objects
   * @returns {string} theme key ('reflection' is the safe default)
   */
  function detectTheme(questions) {
    var texts = normalizeQuestions(questions);
    var haystack = texts.join(' ');
    if (!haystack) return 'reflection';
    for (var i = 0; i < THEME_ORDER.length; i++) {
      if (THEME_ORDER[i].match.test(haystack)) return THEME_ORDER[i].key;
    }
    return 'reflection';
  }

  function hasBannedContent(text) {
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < BANNED_PHRASES.length; i++) {
      if (t.indexOf(BANNED_PHRASES[i]) !== -1) return true;
    }
    return false;
  }

  function hasJargon(text) {
    var t = String(text || '');
    for (var i = 0; i < JARGON.length; i++) {
      var re = new RegExp('\\b' + JARGON[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(t)) return true;
    }
    return false;
  }

  /**
   * Deterministically select a two-sentence pair for the given theme, seeded
   * by the question text so the same context always yields the same card.
   */
  function pickLines(themeKey, texts) {
    var def = THEMES[themeKey] || THEMES.reflection;
    var pool = def.lines;
    var seed = 0;
    var joined = texts.join('');
    for (var i = 0; i < joined.length; i++) seed += joined.charCodeAt(i);
    var pair = pool[seed % pool.length];
    return pair.slice();
  }

  /**
   * Generate the share-card copy.
   * @param {Array} questions - user's completed question context (may be empty)
   * @param {*} [readingContext] - reserved for future context signals
   * @returns {{theme: string, sentences: string[]}} exactly two sentences
   */
  function getMomentCopy(questions, readingContext) {
    var texts = normalizeQuestions(questions);
    var themeKey = detectTheme(texts);
    var lines = pickLines(themeKey, texts);
    var joined = lines.join(' ');
    if (hasBannedContent(joined) || hasJargon(joined)) {
      themeKey = 'reflection';
      lines = pickLines('reflection', texts);
    }
    return { theme: themeKey, sentences: lines };
  }

  /**
   * Semantic card markup (used for tests and as the card's accessible label).
   * Contains branding, the heading, exactly two sentence lines, and the
   * bottom branding mark.
   */
  function buildCardMarkup(copy) {
    copy = copy || {};
    var sentences = Array.isArray(copy.sentences) ? copy.sentences : [];
    var theme = escapeAttr(copy.theme || 'reflection');
    var html = '<div class="palm-moment__card" data-theme="' + theme + '">';
    html += '<p class="palm-moment__eyebrow">✦ PalmPyaar ✦</p>';
    html += '<h3 class="palm-moment__heading">' + escapeHtml(HEADING) + '</h3>';
    for (var i = 0; i < sentences.length; i++) {
      html += '<p class="palm-moment__line">' + escapeHtml(sentences[i]) + '</p>';
    }
    html += '<p class="palm-moment__signature">' + escapeHtml(SIGNATURE) + '</p>';
    html += '</div>';
    return html;
  }

  /**
   * Decide the sharing path without touching the DOM:
   * 'share' only when native Web Share with file payloads is available.
   * @param {{share: boolean, canShareFiles: boolean}} opts
   * @returns {'share'|'download'}
   */
  function resolveShareAction(opts) {
    opts = opts || {};
    if (opts.share === true && opts.canShareFiles === true) return 'share';
    return 'download';
  }

  function getCardSpec() {
    return {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      ratio: '9:16',
      filename: FILENAME,
      heading: HEADING,
      brand: BRAND
    };
  }

  // ---------------------------------------------------------------------------
  // Browser-only rendering + sharing (guarded, never executed under Node)
  // ---------------------------------------------------------------------------

  var revealed = false;

  function wrapText(ctx, text, maxWidth) {
    var words = String(text).split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawStar(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0);
    ctx.quadraticCurveTo(r * 0.12, r * 0.12, 0, r);
    ctx.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0);
    ctx.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r);
    ctx.fillStyle = '#E8A33D';
    ctx.fill();
    ctx.restore();
  }

  function drawCard(canvas, copy) {
    if (!canvas || !copy) return;
    var W = CARD_WIDTH;
    var H = CARD_HEIGHT;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background — PalmPyaar night
    ctx.fillStyle = '#14111F';
    ctx.fillRect(0, 0, W, H);

    // Subtle gold glow near the top
    var glow = ctx.createRadialGradient(W / 2, 320, 40, W / 2, 320, 780);
    glow.addColorStop(0, 'rgba(232, 163, 61, 0.10)');
    glow.addColorStop(1, 'rgba(232, 163, 61, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Faint halo ring behind the heading
    ctx.beginPath();
    ctx.arc(W / 2, 585, 330, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 163, 61, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Signature curve motif (rose → gold), echoing the PalmPyaar mark
    var curve = ctx.createLinearGradient(150, 330, 950, 250);
    curve.addColorStop(0, '#B5555C');
    curve.addColorStop(1, '#E8A33D');
    ctx.beginPath();
    ctx.moveTo(150, 330);
    ctx.bezierCurveTo(300, 240, 430, 420, 600, 340);
    ctx.bezierCurveTo(760, 260, 860, 360, 950, 300);
    ctx.strokeStyle = curve;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawStar(ctx, 600, 330, 7);
    drawStar(ctx, 760, 270, 5);
    drawStar(ctx, 950, 300, 5);

    // Eyebrow — the PalmPyaar wordmark, set like the site's hero title
    // (Fraunces 500, -0.03em tracking) in the card's brand gold.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#E8A33D';
    ctx.font = '500 52px Fraunces, Georgia, serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '-1.56px';
    ctx.fillText('PalmPyaar', W / 2, 455);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    // Heading
    ctx.font = '600 62px Fraunces, Georgia, serif';
    if (ctx.measureText(HEADING).width > 760) {
      ctx.font = '600 52px Fraunces, Georgia, serif';
    }
    ctx.fillStyle = '#F7ECE4';
    ctx.fillText(HEADING, W / 2, 585);

    // Divider
    ctx.beginPath();
    ctx.moveTo(W / 2 - 90, 690);
    ctx.lineTo(W / 2 + 90, 690);
    ctx.strokeStyle = 'rgba(232, 163, 61, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // The two reflective sentences
    var sentences = (copy.sentences && copy.sentences.length) ? copy.sentences : [];
    ctx.fillStyle = '#EFEAE2';
    ctx.font = 'italic 500 45px Fraunces, Georgia, serif';
    var maxTextWidth = 690;
    var blocks = [];
    for (var i = 0; i < sentences.length; i++) {
      blocks.push(wrapText(ctx, sentences[i], maxTextWidth));
    }
    var lineHeight = 68;
    var y = 850;
    for (var k = 0; k < blocks.length; k++) {
      var blockLines = blocks[k];
      for (var m = 0; m < blockLines.length; m++) {
        ctx.fillText(blockLines[m], W / 2, y);
        y += lineHeight;
      }
      if (k < blocks.length - 1) y += 26;
    }

    // Bottom branding
    ctx.beginPath();
    ctx.moveTo(W / 2 - 60, 1720);
    ctx.lineTo(W / 2 + 60, 1720);
    ctx.strokeStyle = 'rgba(232, 163, 61, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#E8A33D';
    ctx.font = '500 40px Fraunces, Georgia, serif';
    ctx.fillText('PalmPyaar', W / 2, 1775);
    ctx.fillStyle = 'rgba(239, 234, 226, 0.55)';
    ctx.font = '400 26px Manrope, "Noto Sans", system-ui, sans-serif';
    ctx.fillText('Made for your reflection', W / 2, 1825);
  }

  function readQuestionsFromDom() {
    if (typeof document === 'undefined') return [];
    var nodes = document.querySelectorAll('#question-list .question-item__q');
    var texts = [];
    for (var i = 0; i < nodes.length; i++) {
      var text = (nodes[i].textContent || '').replace(/^Q\d+\s*:\s*/, '').trim();
      if (text) texts.push(text);
    }
    return texts;
  }

  function setStatus(message) {
    var el = document.getElementById('palm-moment-status');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function downloadBlob(blob) {
    if (typeof URL === 'undefined' || typeof document === 'undefined') return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = FILENAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function canShareFiles(blob) {
    try {
      if (typeof navigator === 'undefined' || !navigator.canShare) return false;
      var file = new File([blob], FILENAME, { type: 'image/png' });
      return navigator.canShare({ files: [file] }) === true;
    } catch (e) {
      return false;
    }
  }

  function shareOrDownload(sharePreferred) {
    var canvas = document.getElementById('palm-moment-canvas');
    if (!canvas) return;
    canvas.toBlob(function (blob) {
      if (!blob) {
        setStatus('Could not create the card image. Please try again.');
        return;
      }
      var useShare = sharePreferred && canShareFiles(blob);
      if (useShare && typeof navigator !== 'undefined' && navigator.share) {
        var file = new File([blob], FILENAME, { type: 'image/png' });
        navigator.share({ title: 'PalmPyaar Moment', text: HEADING, files: [file] })
          .then(function () {
            setStatus('Shared. Post it wherever you like.');
          })
          .catch(function (err) {
            if (!err || err.name !== 'AbortError') {
              downloadBlob(blob);
              setStatus('Native sharing was unavailable, so the card was downloaded instead.');
            }
          });
      } else {
        downloadBlob(blob);
        setStatus('Card downloaded. Post it to Instagram, Snapchat, Facebook, or YouTube.');
      }
    }, 'image/png');
  }

  function wireButtons() {
    var shareBtn = document.getElementById('palm-moment-share');
    var downloadBtn = document.getElementById('palm-moment-download');
    if (shareBtn) shareBtn.onclick = function () { shareOrDownload(true); };
    if (downloadBtn) downloadBtn.onclick = function () { shareOrDownload(false); };
  }

  /**
   * Show the PalmPyaar Moment section once, draw the card, and wire the
   * share/download actions. Idempotent — safe to call repeatedly.
   */
  function reveal() {
    if (revealed || typeof document === 'undefined') return;
    revealed = true;

    var copy = getMomentCopy(readQuestionsFromDom());

    var section = document.getElementById('palm-moment');
    if (section) {
      section.hidden = false;
      section.setAttribute('aria-label', buildCardMarkup(copy).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    }

    var canvas = document.getElementById('palm-moment-canvas');
    if (canvas) {
      var draw = function () { drawCard(canvas, copy); };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(draw);
      } else {
        draw();
      }
    }

    wireButtons();
  }

  if (typeof window !== 'undefined') {
    window.PalmMoment = {
      reveal: reveal,
      getMomentCopy: getMomentCopy,
      detectTheme: detectTheme,
      resolveShareAction: resolveShareAction,
      buildCardMarkup: buildCardMarkup
    };
  }

  // Node-testable surface (browser scripts do not have module/exports).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      THEMES: THEMES,
      BANNED_PHRASES: BANNED_PHRASES,
      JARGON: JARGON,
      BRAND: BRAND,
      HEADING: HEADING,
      SIGNATURE: SIGNATURE,
      FILENAME: FILENAME,
      CARD_WIDTH: CARD_WIDTH,
      CARD_HEIGHT: CARD_HEIGHT,
      detectTheme: detectTheme,
      getMomentCopy: getMomentCopy,
      buildCardMarkup: buildCardMarkup,
      resolveShareAction: resolveShareAction,
      getCardSpec: getCardSpec,
      hasBannedContent: hasBannedContent,
      hasJargon: hasJargon
    };
  }
})();
