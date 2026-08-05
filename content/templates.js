/**
 * PalmPyaar template library — Phase 1: public teaser set only.
 * Full reading fragments added in Phase 3.
 */
(function (global) {
  'use strict';

  var TEASER_TEMPLATES = {
    western: {
      Aries: [
        'Your chart suggests a restless warmth — you tend to move toward what excites you, even when the path isn\'t fully mapped.',
        'There\'s a spark here that may indicate someone who leads with instinct; this reading hints at courage worn quietly, not loudly.',
        'This suggests a nature that thrives on beginnings — you may find old routines feel heavier than fresh challenges.'
      ],
      Taurus: [
        'Your sign tends toward steadiness; this reading suggests you build trust slowly, but once given, it runs deep.',
        'There\'s a sensory richness here — you may indicate someone who remembers how things felt, not just how they looked.',
        'This suggests patience as a quiet strength; you tend to outlast what others merely endure.'
      ],
      Gemini: [
        'Your chart hints at a mind that moves in pairs — curiosity and restlessness may indicate a love of many threads at once.',
        'This suggests someone who reads the room quickly; you tend to adapt before others notice the shift.',
        'There\'s a lightness here that may indicate charm used as connection, not performance.'
      ],
      Cancer: [
        'Your sign suggests deep tides beneath a calm surface — you may protect what matters before you reveal it.',
        'This reading hints at memory as emotional architecture; you tend to carry places and people long after leaving.',
        'There\'s a nurturing quality here that may indicate care expressed through presence, not words alone.'
      ],
      Leo: [
        'Your chart suggests warmth that draws people in — you may indicate someone who shines best when genuinely seen.',
        'This reading hints at pride worn as devotion; you tend to give generously when your heart is engaged.',
        'There\'s a creative pulse here that may suggest you need an audience of one — yourself included.'
      ],
      Virgo: [
        'Your sign tends toward refinement; this suggests you notice what others miss and may quietly fix what isn\'t yours to fix.',
        'This reading hints at precision as a form of care — you may indicate love through small, deliberate acts.',
        'There\'s a thoughtful restraint here that suggests depth prefers order before expression.'
      ],
      Libra: [
        'Your chart suggests harmony sought, not always found — you may indicate someone who weighs every angle before choosing.',
        'This reading hints at beauty as balance; you tend to feel discord before others name it.',
        'There\'s a relational grace here that may suggest you mirror what you hope to receive.'
      ],
      Scorpio: [
        'Your sign suggests intensity held close — this reading may indicate depths others glimpse but rarely reach.',
        'There\'s a magnetic quality here; you tend to transform what you touch, sometimes without intending to.',
        'This suggests loyalty forged in fire — you may protect secrets as carefully as you keep your own.'
      ],
      Sagittarius: [
        'Your chart hints at horizons always ahead — you may indicate someone who trusts the journey over the map.',
        'This reading suggests optimism with teeth; you tend to speak truth even when it costs comfort.',
        'There\'s a wanderer\'s spirit here that may suggest freedom is less a choice than a need.'
      ],
      Capricorn: [
        'Your sign tends toward the long view; this suggests ambition worn as responsibility, not display.',
        'This reading hints at endurance — you may indicate someone who builds quietly while others celebrate starts.',
        'There\'s a grounded wisdom here that suggests patience is your most underrated strength.'
      ],
      Aquarius: [
        'Your chart suggests thinking slightly ahead of the room — you may indicate someone who belongs everywhere and nowhere.',
        'This reading hints at ideals held firmly; you tend to champion what others haven\'t named yet.',
        'There\'s an independent current here that may suggest connection on your own terms feels most true.'
      ],
      Pisces: [
        'Your sign suggests porous boundaries — this reading may indicate you absorb atmospheres before words arrive.',
        'There\'s a dreamer\'s depth here; you tend to feel the undercurrent while others watch the surface.',
        'This suggests compassion that flows quietly — you may heal without claiming credit for it.'
      ]
    },
    vedic: {
      Aries: [
        'Mesha energy suggests a pioneering spirit — you may tend toward action before hesitation settles in.',
        'This reading hints at Mars-ruled courage; your nature may indicate leadership that feels instinctive, not performed.',
        'There\'s a fiery clarity here that suggests you move toward purpose even when the outcome is uncertain.'
      ],
      Taurus: [
        'Vrishabha suggests steadiness rooted in the senses — you may indicate someone who finds truth in what endures.',
        'This reading hints at Venusian patience; you tend to cultivate rather than chase.',
        'There\'s a grounded devotion here that may suggest loyalty expressed through constancy, not grand gestures.'
      ],
      Gemini: [
        'Mithuna energy suggests a quick, adaptable mind — you may indicate someone who thrives on exchange and variety.',
        'This reading hints at duality as strength; you tend to hold multiple truths without forcing resolution.',
        'There\'s a mercurial brightness here that may suggest connection through conversation above all.'
      ],
      Cancer: [
        'Karka suggests deep emotional tides — this reading may indicate you nurture through protection first.',
        'Your chart hints at lunar sensitivity; you tend to remember what the heart felt, not just what occurred.',
        'There\'s a home-seeking quality here that suggests belonging matters as much as achievement.'
      ],
      Leo: [
        'Simha energy suggests radiant warmth — you may indicate someone whose presence lifts a room without effort.',
        'This reading hints at solar confidence worn generously; you tend to share light rather than hoard it.',
        'There\'s a regal ease here that may suggest you lead best when your heart is fully engaged.'
      ],
      Virgo: [
        'Kanya suggests refinement through service — you may indicate someone who improves what they touch quietly.',
        'This reading hints at discernment as devotion; you tend to notice details others overlook entirely.',
        'There\'s a practical wisdom here that suggests care expressed through thoughtful action.'
      ],
      Libra: [
        'Tula energy suggests balance sought in all things — you may indicate someone who weighs harmony before decision.',
        'This reading hints at partnership as mirror; you tend to reflect what you hope to cultivate.',
        'There\'s a graceful equilibrium here that may suggest beauty and fairness feel inseparable to you.'
      ],
      Scorpio: [
        'Vrishchika suggests depth and transformation — this reading may indicate intensity held with deliberate care.',
        'Your chart hints at hidden reserves; you tend to reveal truth only when trust is fully earned.',
        'There\'s a magnetic stillness here that suggests power prefers silence to display.'
      ],
      Sagittarius: [
        'Dhanu energy suggests an arrow always drawn toward meaning — you may indicate someone who trusts the path.',
        'This reading hints at Jupiterian optimism; you tend to find wisdom in experience, not theory alone.',
        'There\'s an expansive spirit here that may suggest freedom feels essential to your sense of self.'
      ],
      Capricorn: [
        'Makara suggests ambition with discipline — you may indicate someone who builds legacy through patience.',
        'This reading hints at Saturnian endurance; you tend to outlast what others merely begin.',
        'There\'s a quiet authority here that suggests respect is earned, never assumed.'
      ],
      Aquarius: [
        'Kumbha energy suggests vision ahead of its time — you may indicate someone who thinks in futures, not trends.',
        'This reading hints at humanitarian impulse; you tend to champion ideas before they become comfortable.',
        'There\'s an independent current here that may suggest community on your own terms feels most authentic.'
      ],
      Pisces: [
        'Meena suggests boundless empathy — this reading may indicate you feel what others haven\'t yet named.',
        'Your chart hints at spiritual porousness; you tend to dissolve boundaries between self and other.',
        'There\'s a gentle depth here that suggests compassion flows without needing acknowledgment.'
      ]
    },
    hellenic: {
      Aries: [
        'Ares-ruled fire suggests bold beginnings — you may tend toward courage when others hesitate.',
        'This reading hints at the hero\'s impulse; you may indicate someone who acts before doubt takes root.',
        'There\'s a warrior\'s warmth here that suggests passion prefers motion to stillness.'
      ],
      Taurus: [
        'Aphrodite\'s earth suggests sensual steadiness — you may indicate someone who finds beauty in what lasts.',
        'This reading hints at pleasure as wisdom; you tend to trust the body\'s quiet knowing.',
        'There\'s a cultivated patience here that may suggest devotion expressed through presence.'
      ],
      Gemini: [
        'Hermes\' quicksilver mind suggests adaptability — you may indicate someone who speaks many languages, literal and otherwise.',
        'This reading hints at the messenger\'s gift; you tend to connect threads others leave separate.',
        'There\'s a playful intelligence here that may suggest curiosity is your most faithful companion.'
      ],
      Cancer: [
        'Artemis\' moonlit depth suggests protective tenderness — this reading may indicate you guard what you love.',
        'Your chart hints at the nurturer\'s shell; you tend to offer warmth only after trust is earned.',
        'There\'s a tidal memory here that suggests the past lives vividly in your present.'
      ],
      Leo: [
        'Apollo\'s radiance suggests creative confidence — you may indicate someone who shines when authentically seen.',
        'This reading hints at the sun\'s generosity; you tend to warm others without dimming yourself.',
        'There\'s a noble warmth here that may suggest pride and devotion are closely intertwined.'
      ],
      Virgo: [
        'Athena\'s discernment suggests thoughtful craft — you may indicate someone who refines before revealing.',
        'This reading hints at wisdom through observation; you tend to improve through careful attention.',
        'There\'s a quiet mastery here that suggests excellence prefers humility to announcement.'
      ],
      Libra: [
        'The scales of Themis suggest fairness sought — you may indicate someone who weighs every side before judgment.',
        'This reading hints at harmony as ideal; you tend to feel imbalance before it becomes visible.',
        'There\'s a diplomatic grace here that may suggest peace is both goal and method.'
      ],
      Scorpio: [
        'Hades\' realm suggests transformative depth — this reading may indicate you carry secrets like sacred trust.',
        'Your chart hints at the phoenix\'s nature; you tend to regenerate rather than merely recover.',
        'There\'s an underworld intensity here that suggests truth prefers darkness before light.'
      ],
      Sagittarius: [
        'Zeus\' archer suggests aim toward the horizon — you may indicate someone who trusts the journey\'s wisdom.',
        'This reading hints at the philosopher\'s fire; you tend to seek meaning in every experience.',
        'There\'s an expansive optimism here that may suggest freedom is your native element.'
      ],
      Capricorn: [
        'Chronos\' discipline suggests the long climb — you may indicate someone who builds with generational patience.',
        'This reading hints at Saturn\'s lesson; you tend to earn what others inherit or assume.',
        'There\'s a stoic strength here that suggests time is your ally, not your enemy.'
      ],
      Aquarius: [
        'Ouranos\' vision suggests thinking beyond the present — you may indicate someone who belongs to tomorrow.',
        'This reading hints at the rebel\'s clarity; you tend to question before you conform.',
        'There\'s a humanitarian impulse here that may suggest ideals guide action more than tradition.'
      ],
      Pisces: [
        'Poseidon\'s depths suggest oceanic feeling — this reading may indicate you navigate by intuition, not map.',
        'Your chart hints at the mystic\'s gift; you tend to sense undercurrents others miss entirely.',
        'There\'s a dissolving empathy here that suggests boundaries between souls feel permeable to you.'
      ]
    }
  };

  /**
   * Select a teaser line deterministically from sign + seed.
   * @param {string} sign - Western zodiac sign name
   * @param {string} tradition - western | vedic | hellenic
   * @param {number} seed - numeric seed from sign + photo hash
   * @returns {string}
   */
  function getTeaserLine(sign, tradition, seed) {
    var pool = TEASER_TEMPLATES[tradition] && TEASER_TEMPLATES[tradition][sign];
    if (!pool || !pool.length) {
      pool = TEASER_TEMPLATES.western[sign] || ['Your chart suggests something worth exploring — a full reading may reveal more.'];
    }
    var index = Math.abs(seed) % pool.length;
    return pool[index];
  }

  global.PalmTemplates = {
    getTeaserLine: getTeaserLine
  };
})(typeof window !== 'undefined' ? window : global);
