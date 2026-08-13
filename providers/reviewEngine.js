/**
 * PalmPyaar Review Engine — Quality Assurance Layer
 * 
 * ARCHITECTURE POSITION:
 * 
 * Generation (Groq/Template) → Review Engine → (Optional) Rewrite Loop → Final Output
 * 
 * This module NEVER rewrites. It ONLY evaluates.
 * 
 * WHY REVIEWING IS SEPARATED FROM REWRITING:
 * 
 * 1. Separation of Concerns: Evaluation requires different cognitive modes than generation.
 *    Generation is expansive (creating possibilities). Review is contractive (applying standards).
 *    Mixing them conflates creativity with criticism, degrading both.
 * 
 * 2. Deterministic Audit Trail: A pure review function produces consistent, explainable scores
 *    for the same input. This enables regression testing, quality monitoring, and
 *    human-in-the-loop oversight without re-running expensive AI generation.
 * 
 * 3. Rewrite Loop Enablement: By returning structured `rewriteTargets`, the review engine
 *    feeds a potential rewrite phase (future Phase 8) with precise, actionable directives
 *    rather than vague "make it better" prompts. This targets fixes surgically.
 * 
 * 4. Cost Control: Review is cheap (deterministic, no API calls). Generation is expensive.
 *    Running review first prevents wasting tokens on obviously flawed outputs.
 * 
 * WHY SCORING EXISTS:
 * 
 * - Quantifies quality gates: `passed` boolean derives from scores, enabling automated
 *   accept/reject/rewrite decisions in the pipeline.
 * - Enables trend analysis: Tracking scores over time reveals model drift or prompt decay.
 * - Provides diagnostic granularity: A low `traditionAuthenticity` score pinpoints
 *   exactly which prompt component needs strengthening.
 * - Supports A/B testing: Numerical scores allow statistical comparison of prompt versions.
 * 
 * WHY REWRITE TARGETS IMPROVE QUALITY:
 * 
 * - Specificity beats generality: "Section LOVE repeats generic advice" is actionable.
 *   "Make it better" is not.
 * - Section-level targeting: Rewrites can be scoped to only the problematic section,
 *   preserving what works elsewhere (CORE, PRO).
 * - Problem + Improvement pairing: Each target names the flaw AND the desired state,
 *   giving a rewrite prompt (future) a clear before/after contract.
 * 
 * @module providers/reviewEngine
 */

/**
 * Reviews a completed reading against PalmPyaar's 9 quality dimensions.
 * 
 * PURE FUNCTION: No side effects, no I/O, no AI calls, no randomness.
 * Same inputs → same outputs. Suitable for testing, caching, and audit logs.
 * 
 * @param {Object} params - Review inputs
 * @param {Object} params.reading - Generated reading with core, love, pro sections
 * @param {string} params.reading.core - CORE section text (Recognition stage)
 * @param {string} params.reading.love - LOVE section text (Reflection stage)
 * @param {string} params.reading.pro - PRO section text (Hope → Calm stage)
 * @param {Object} params.reasoningPlan - Structured plan from reasoningPlanner
 * @param {string} params.reasoningPlan.centralTheme - Central narrative theme
 * @param {string[]} params.reasoningPlan.supportingThemes - Supporting themes
 * @param {string} params.reasoningPlan.emotionalDestination - Target emotional state
 * @param {string} params.reasoningPlan.symbolicThread - Symbolic motif
 * @param {string} params.reasoningPlan.coreFocus - CORE section focus
 * @param {string} params.reasoningPlan.loveFocus - LOVE section focus
 * @param {string} params.reasoningPlan.proFocus - PRO section focus
 * @param {string} params.reasoningPlan.openingMood - Opening mood
 * @param {string} params.reasoningPlan.closingMood - Closing mood
 * @param {Object} params.reasoningPlan.callbackStrategy - Callback architecture
 * @param {string} params.reasoningPlan.narrativeFlow - Narrative flow pattern
 * @param {string} params.reasoningPlan.literaryStyle - Literary style descriptor
 * @param {string} params.reasoningPlan.traditionLens - Tradition interpretive lens
 * @param {string} params.tradition - Tradition identifier ('western'|'vedic'|'hellenic')
 * @param {Object} params.userContext - Sanitized user context
 * @param {string} params.userContext.name - User's name
 * @param {string} params.userContext.dob - Date of birth
 * @param {string} params.userContext.birthplace - Birth location
 * @param {string} params.userContext.tradition - Tradition
 * @param {boolean} params.userContext.photoHashPresent - Whether palm photo provided
 * @param {Object|null} [params.userContext.palmEvidence] - Verified geometric palm evidence (MODE B) or null (MODE A)
 * @returns {Object} Review result
 * @property {number} overallScore - Mean of 9 category scores (1-10, one decimal)
 * @property {Object} scores - Individual category scores (1-10, one decimal)
 * @property {number} scores.recognition - CORE: Does it recognize the person?
 * @property {number} scores.traditionAuthenticity - Tradition framework correctly applied?
 * @property {number} scores.literaryQuality - Prose craft: rhythm, imagery, voice
 * @property {number} scores.emotionalDepth - Emotional resonance and specificity
 * @property {number} scores.originality - Avoids cliché, template feel, generic advice
 * @property {number} scores.coherence - Narrative unity across three sections
 * @property {number} scores.humanFeel - Feels written by a person, not generated
 * @property {number} scores.premiumExperience - Meets ≥9/10 premium bar
 * @property {number} scores.overall - Holistic impression (mirrors overallScore)
 * @property {string[]} strengths - Concise positive observations
 * @property {string[]} weaknesses - Concise negative observations
 * @property {Object[]} rewriteTargets - Actionable rewrite directives
 * @property {string} rewriteTargets[].section - 'CORE'|'LOVE'|'PRO'
 * @property {string} rewriteTargets[].problem - Specific flaw description
 * @property {string} rewriteTargets[].improvement - Desired end state
 * @property {boolean} passed - True iff overallScore >= 9 AND no score < 8.5
 * @property {string} reviewSummary - One-paragraph quality assessment
 */
function reviewReading({ reading, reasoningPlan, tradition, userContext }) {
    // Input validation
    if (!reading || typeof reading !== 'object') {
        throw new Error('reviewReading: reading object is required');
    }
    if (!reasoningPlan || typeof reasoningPlan !== 'object') {
        throw new Error('reviewReading: reasoningPlan object is required');
    }
    if (!tradition || typeof tradition !== 'string') {
        throw new Error('reviewReading: tradition string is required');
    }
    if (!userContext || typeof userContext !== 'object') {
        throw new Error('reviewReading: userContext object is required');
    }

    const { core, love, pro } = reading;
    const sections = { core, love, pro };

    // Compute all 9 scores
    const scores = {
        recognition: scoreRecognition(core, reasoningPlan, userContext),
        traditionAuthenticity: scoreTraditionAuthenticity(sections, reasoningPlan, tradition),
        literaryQuality: scoreLiteraryQuality(sections),
        emotionalDepth: scoreEmotionalDepth(sections, reasoningPlan),
        originality: scoreOriginality(sections, reasoningPlan),
        coherence: scoreCoherence(sections, reasoningPlan),
        humanFeel: scoreHumanFeel(sections),
        premiumExperience: scorePremiumExperience(sections, reasoningPlan),
        overall: 0 // Will be set after computing mean
    };

    // Overall is mean of the 8 category scores (excluding itself)
    const categoryScores = [
        scores.recognition,
        scores.traditionAuthenticity,
        scores.literaryQuality,
        scores.emotionalDepth,
        scores.originality,
        scores.coherence,
        scores.humanFeel,
        scores.premiumExperience
    ];
    scores.overall = Math.round((categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length) * 10) / 10;

    // Overall score mirrors scores.overall
    const overallScore = scores.overall;

    // Generate qualitative feedback
    const strengths = identifyStrengths(sections, scores, reasoningPlan);
    const weaknesses = identifyWeaknesses(sections, scores, reasoningPlan);
    const rewriteTargets = generateRewriteTargets(sections, scores, weaknesses, reasoningPlan);

    // Pass threshold: overall >= 9 AND no individual category below 8.5
    const passed = overallScore >= 9 && categoryScores.every(s => s >= 8.5);

    // One-paragraph summary
    const reviewSummary = generateReviewSummary(overallScore, passed, strengths, weaknesses, tradition);

    return {
        overallScore,
        scores,
        strengths,
        weaknesses,
        rewriteTargets,
        passed,
        reviewSummary
    };
}

/**
 * SCORE: Recognition (CORE section)
 * Does the reading recognize THIS specific person?
 * Checks: name usage, specific birth details, personal addressing, avoids generic "you"
 */
function scoreRecognition(core, reasoningPlan, userContext) {
    if (!core || typeof core !== 'string' || core.trim().length === 0) {
        return 1;
    }

    let score = 5; // Baseline

    const text = core.toLowerCase();
    const rawName = userContext.name;
    const name = (typeof rawName === 'string' ? rawName : '').trim().toLowerCase();

    // Name appears naturally (not just once at start)
    let nameCount = 0;
    if (name) {
        nameCount = (core.match(new RegExp(escapeRegExp(name), 'gi')) || []).length;
    }
    if (nameCount >= 2) score += 1.5;
    else if (nameCount === 1) score += 0.5;

    // Birth details referenced
    if (text.includes(userContext.dob) || text.includes(userContext.birthplace.toLowerCase())) {
        score += 1;
    }

    // Personal addressing ("your", "you" in context of the person)
    const personalRefs = (core.match(/\byour\b|\byou\b/gi) || []).length;
    if (personalRefs >= 3) score += 1;
    else if (personalRefs >= 1) score += 0.5;

    // Avoids generic "a person" / "someone" / "the native"
    const genericRefs = (core.match(/\b(a person|someone|the native|an individual)\b/gi) || []).length;
    if (genericRefs === 0) score += 1;
    else score -= genericRefs * 0.5;

    // Central theme from plan reflected in CORE
    if (reasoningPlan.centralTheme && core.toLowerCase().includes(reasoningPlan.centralTheme.toLowerCase())) {
        score += 1;
    }

    return clampScore(score);
}

/**
 * SCORE: Tradition Authenticity
 * Does the reading correctly apply the chosen tradition's framework?
 * Checks: tradition-specific terminology, reasoning moves, symbolic language
 */
function scoreTraditionAuthenticity(sections, reasoningPlan, tradition) {
    const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
    let score = 5;

    const traditionMarkers = {
        western: ['planet', 'house', 'aspect', 'transit', 'sign', 'degree', 'orb', 'rulership', 'dignity', 'element', 'modality'],
        vedic: ['graha', 'bhava', 'rasi', 'nakshatra', 'dasha', 'yoga', 'karaka', 'drishti', 'uccha', 'neecha', 'varga'],
        hellenic: ['star', 'lot', 'sect', 'time-lord', 'profection', 'zodiacal releasing', 'decans', 'bounds', 'triplicity', 'almuten']
    };

    const markers = traditionMarkers[tradition] || [];
    let foundMarkers = 0;
    for (const marker of markers) {
        if (allText.includes(marker)) foundMarkers++;
    }

    // Score based on marker density
    if (foundMarkers >= 5) score += 3;
    else if (foundMarkers >= 3) score += 2;
    else if (foundMarkers >= 1) score += 1;
    else score -= 2;

    // Tradition lens from plan should be evident
    if (reasoningPlan.traditionLens && allText.includes(reasoningPlan.traditionLens.toLowerCase())) {
        score += 1;
    }

    // Symbolic thread should use tradition-appropriate imagery
    if (reasoningPlan.symbolicThread && allText.includes(reasoningPlan.symbolicThread.toLowerCase())) {
        score += 1;
    }

    return clampScore(score);
}

/**
 * SCORE: Literary Quality
 * Prose craft: rhythm, imagery, sentence variety, voice consistency
 */
function scoreLiteraryQuality(sections) {
    const allText = sections.core + ' ' + sections.love + ' ' + sections.pro;
    if (!allText || allText.trim().length === 0) return 1;

    let score = 5;
    const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (sentences.length === 0) return 1;

    // Sentence length variety (not all same length)
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / lengths.length;
    if (variance > 50) score += 1.5; // Good variety
    else if (variance > 20) score += 0.5;
    else score -= 1; // Monotonous

    // Imagery density (metaphor, simile, sensory language)
    const imageryPatterns = [
        /\b(like|as)\s+\w+/gi,           // Similes
        /\b(is|was|are|were)\s+a\s+\w+/gi, // Metaphors
        /\b(feel|taste|smell|sound|look|see|hear|touch)\w*/gi, // Sensory
        /\b(light|dark|shadow|fire|water|earth|air|wind|storm|calm|depth|height)\b/gi // Elemental
    ];
    let imageryCount = 0;
    for (const pattern of imageryPatterns) {
        imageryCount += (allText.match(pattern) || []).length;
    }
    if (imageryCount >= 8) score += 2;
    else if (imageryCount >= 4) score += 1;
    else if (imageryCount === 0) score -= 1.5;

    // Opening hook quality (first sentence of CORE)
    const firstSentence = sections.core?.split(/[.!?]/)[0]?.trim() || '';
    if (firstSentence.length > 20 && firstSentence.length < 200) {
        // Not too short, not run-on
        if (/[?,!]/.test(firstSentence) || /\b(your|you|when|as|while|since)\b/i.test(firstSentence)) {
            score += 0.5; // Engaging structure
        }
    }

    // Closing resonance (last sentence of PRO)
    const proSentences = sections.pro?.split(/[.!?]+/).filter(s => s.trim().length > 0) || [];
    const lastSentence = proSentences[proSentences.length - 1]?.trim() || '';
    if (lastSentence.length > 15 && /\b(you|your|will|can|may|remember|know|trust|believe)\b/i.test(lastSentence)) {
        score += 0.5;
    }

    return clampScore(score);
}

/**
 * SCORE: Emotional Depth
 * Emotional resonance, specificity, avoids platitudes
 */
function scoreEmotionalDepth(sections, reasoningPlan) {
    const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
    let score = 5;

    // Emotional destination from plan should be approached
    if (reasoningPlan.emotionalDestination) {
        const destWords = reasoningPlan.emotionalDestination.toLowerCase().split(/\s+/);
        const destMatches = destWords.filter(w => w.length > 3 && allText.includes(w)).length;
        if (destMatches >= 2) score += 1.5;
        else if (destMatches >= 1) score += 0.5;
    }

    // Emotional vocabulary richness
    const emotionWords = [
        'longing', 'yearning', 'ache', 'tender', 'vulnerable', 'raw', 'exposed',
        'hope', 'fear', 'courage', 'doubt', 'certainty', 'trust', 'surrender',
        'grief', 'joy', 'sorrow', 'peace', 'turmoil', 'calm', 'storm',
        'intimate', 'distant', 'close', 'separate', 'connected', 'alone', 'together'
    ];
    let emotionCount = 0;
    for (const word of emotionWords) {
        if (allText.includes(word)) emotionCount++;
    }
    if (emotionCount >= 6) score += 2;
    else if (emotionCount >= 3) score += 1;
    else if (emotionCount === 0) score -= 1.5;

    // LOVE section specifically should have emotional specificity
    const loveText = (sections.love || '').toLowerCase();
    const loveEmotionWords = ['heart', 'love', 'relationship', 'partner', 'intimacy', 'connection', 'desire', 'need', 'fear', 'hope'];
    let loveEmotionCount = 0;
    for (const word of loveEmotionWords) {
        if (loveText.includes(word)) loveEmotionCount++;
    }
    if (loveEmotionCount >= 4) score += 1;
    else if (loveEmotionCount === 0) score -= 1;

    // Avoids generic emotional platitudes
    const platitudes = ['everything happens for a reason', 'trust the process', 'it will all work out', 'stay positive', 'believe in yourself'];
    let platitudeCount = 0;
    for (const p of platitudes) {
        if (allText.includes(p)) platitudeCount++;
    }
    score -= platitudeCount * 1.5;

    return clampScore(score);
}

/**
 * SCORE: Originality
 * Avoids cliché, template feel, generic advice, stock phrases
 */
function scoreOriginality(sections, reasoningPlan) {
    const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
    let score = 5;

    // Cliché patterns (common in AI-generated astrology)
    const cliches = [
        'the stars indicate', 'the planets suggest', 'your chart shows',
        'you are a natural', 'you have the potential', 'you possess',
        'great things await', 'the universe wants', 'destiny calls',
        'embrace your', 'unlock your', 'discover your', 'tap into your',
        'powerful placement', 'challenging aspect', 'favorable position',
        'remember that', 'keep in mind', 'it is important to'
    ];
    let clicheCount = 0;
    for (const c of cliches) {
        const matches = (allText.match(new RegExp(c.replace(/\s+/g, '\\s+'), 'gi')) || []).length;
        clicheCount += matches;
    }
    score -= Math.min(clicheCount * 0.5, 3); // Cap penalty at 3

    // Template feel: repetitive sentence structures
    const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const starts = sentences.map(s => s.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
    const uniqueStarts = new Set(starts).size;
    if (sentences.length > 0) {
        const startDiversity = uniqueStarts / sentences.length;
        if (startDiversity < 0.5) score -= 1.5; // Too repetitive
        else if (startDiversity < 0.7) score -= 0.5;
    }

    // Supporting themes from plan should create unique angles
    if (reasoningPlan.supportingThemes && reasoningPlan.supportingThemes.length > 0) {
        const themeMatches = reasoningPlan.supportingThemes.filter(t => 
            allText.includes(t.toLowerCase())
        ).length;
        if (themeMatches >= 2) score += 1;
        else if (themeMatches >= 1) score += 0.5;
    }

    // Symbolic thread should create distinctive imagery
    if (reasoningPlan.symbolicThread && allText.includes(reasoningPlan.symbolicThread.toLowerCase())) {
        score += 1;
    }

    return clampScore(score);
}

/**
 * SCORE: Coherence
 * Narrative unity across three sections, callbacks work, flow logical
 */
function scoreCoherence(sections, reasoningPlan) {
    let score = 5;

    // All three sections present and substantial
    const coreLen = (sections.core || '').trim().length;
    const loveLen = (sections.love || '').trim().length;
    const proLen = (sections.pro || '').trim().length;

    if (coreLen < 100 || loveLen < 100 || proLen < 100) {
        score -= 2; // Sections too thin
    }

    // Callback strategy from plan should be evident
    if (reasoningPlan.callbackStrategy) {
        const callbacks = reasoningPlan.callbackStrategy;
        const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
        
        if (callbacks.coreToLove && allText.includes(callbacks.coreToLove.toLowerCase())) score += 1;
        if (callbacks.loveToPro && allText.includes(callbacks.loveToPro.toLowerCase())) score += 1;
        if (callbacks.proToCore && allText.includes(callbacks.proToCore.toLowerCase())) score += 1;
    }

    // Narrative flow from plan should be followed
    if (reasoningPlan.narrativeFlow) {
        const flow = reasoningPlan.narrativeFlow.toLowerCase();
        const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
        // Check for flow-appropriate transitions
        if (flow.includes('spiral') && (allText.includes('return') || allText.includes('again') || allText.includes('deeper'))) score += 0.5;
        if (flow.includes('ascent') && (allText.includes('rise') || allText.includes('higher') || allText.includes('elevat'))) score += 0.5;
        if (flow.includes('descent') && (allText.includes('deep') || allText.includes('within') || allText.includes('core'))) score += 0.5;
    }

    // Section transitions: LOVE should reference CORE, PRO should reference both
    const coreText = (sections.core || '').toLowerCase();
    const loveText = (sections.love || '').toLowerCase();
    const proText = (sections.pro || '').toLowerCase();

    // Extract key nouns from CORE (simple heuristic: capitalized words, 4+ chars)
    const coreNouns = coreText.match(/\b[a-z]{4,}\b/g) || [];
    const coreKeywords = [...new Set(coreNouns)].slice(0, 10);
    
    let loveReferencesCore = 0;
    let proReferencesCore = 0;
    let proReferencesLove = 0;

    for (const kw of coreKeywords) {
        if (loveText.includes(kw)) loveReferencesCore++;
        if (proText.includes(kw)) proReferencesCore++;
    }

    const loveNouns = loveText.match(/\b[a-z]{4,}\b/g) || [];
    const loveKeywords = [...new Set(loveNouns)].slice(0, 10);
    for (const kw of loveKeywords) {
        if (proText.includes(kw)) proReferencesLove++;
    }

    if (loveReferencesCore >= 2) score += 1;
    else if (loveReferencesCore === 0) score -= 1;

    if (proReferencesCore >= 1) score += 0.5;
    if (proReferencesLove >= 1) score += 0.5;

    return clampScore(score);
}

/**
 * SCORE: Human Feel
 * Feels written by a person: idiosyncrasy, imperfection, voice, not robotic
 */
function scoreHumanFeel(sections) {
    const allText = sections.core + ' ' + sections.love + ' ' + sections.pro;
    if (!allText || allText.trim().length === 0) return 1;

    let score = 5;

    // Contractions (human writing uses them)
    const contractions = (allText.match(/\b\w+'(?:re|ve|ll|d|s|t|m)\b/gi) || []).length;
    if (contractions >= 3) score += 1;
    else if (contractions >= 1) score += 0.5;
    else score -= 0.5; // Zero contractions = robotic

    // First-person as narrator (not just "you")
    const firstPerson = (allText.match(/\b(i|my|me|mine)\b/gi) || []).length;
    if (firstPerson >= 2) score += 1;
    else if (firstPerson === 0) score -= 0.5;

    // Rhetorical questions (human engagement)
    const rhetoricalQs = (allText.match(/\?/g) || []).length;
    if (rhetoricalQs >= 2) score += 0.5;
    else if (rhetoricalQs === 0) score -= 0.5;

    // Sentence fragments for effect (stylistic choice)
    const fragments = (allText.match(/\.\s+[A-Z][^.!?]{1,10}[.!?]/g) || []).length;
    if (fragments >= 1) score += 0.5;

    // Avoids bullet-point feel (no "First, ... Second, ... Third, ...")
    const enumerators = (allText.match(/\b(first|second|third|finally|lastly|next|then),/gi) || []).length;
    if (enumerators >= 2) score -= 1.5;

    // Avoids corporate/academic hedging
    const hedges = (allText.match(/\b(it is (?:important|essential|crucial|vital) to|one (?:should|must|ought to)|it is (?:recommended|advised|suggested) that)\b/gi) || []).length;
    score -= hedges * 0.5;

    return clampScore(score);
}

/**
 * SCORE: Premium Experience
 * Meets the ≥9/10 bar: every sentence earns its place, no filler, cinematic quality
 */
function scorePremiumExperience(sections, reasoningPlan) {
    const allText = sections.core + ' ' + sections.love + ' ' + sections.pro;
    if (!allText || allText.trim().length === 0) return 1;

    let score = 5;

    // Length check: substantial but not bloated
    const totalWords = allText.trim().split(/\s+/).length;
    if (totalWords >= 600 && totalWords <= 1500) score += 1;
    else if (totalWords >= 400 && totalWords <= 2000) score += 0.5;
    else if (totalWords < 300) score -= 2;
    else if (totalWords > 2500) score -= 1;

    // Literary style from plan should be evident
    if (reasoningPlan.literaryStyle) {
        const style = reasoningPlan.literaryStyle.toLowerCase();
        const text = allText.toLowerCase();
        if (style.includes('poetic') && (text.match(/\b(like|as|metaphor|symbol|image)\b/gi) || []).length >= 3) score += 1;
        if (style.includes('lyrical') && (text.match(/\b(rhythm|flow|music|song|verse)\b/gi) || []).length >= 1) score += 0.5;
        if (style.includes('direct') && (text.match(/\b(you|your|this|that|here|now)\b/gi) || []).length >= 10) score += 0.5;
    }

    // Opening mood from plan
    if (reasoningPlan.openingMood) {
        const mood = reasoningPlan.openingMood.toLowerCase();
        const firstPara = sections.core?.split('\n')[0]?.toLowerCase() || '';
        if (mood.includes('curiosity') && firstPara.includes('?')) score += 0.5;
        if (mood.includes('intimacy') && firstPara.includes('you')) score += 0.5;
        if (mood.includes('reverence') && (firstPara.includes('sacred') || firstPara.includes('holy') || firstPara.includes('reveren'))) score += 0.5;
    }

    // Closing mood from plan
    if (reasoningPlan.closingMood) {
        const mood = reasoningPlan.closingMood.toLowerCase();
        const proSentences = sections.pro?.split(/[.!?]+/).filter(s => s.trim().length > 0) || [];
        const lastPara = proSentences.slice(-2).join(' ').toLowerCase();
        if (mood.includes('calm') && (lastPara.includes('peace') || lastPara.includes('calm') || lastPara.includes('still') || lastPara.includes('quiet'))) score += 0.5;
        if (mood.includes('empower') && (lastPara.includes('you can') || lastPara.includes('you will') || lastPara.includes('trust') || lastPara.includes('know'))) score += 0.5;
        if (mood.includes('wonder') && (lastPara.includes('wonder') || lastPara.includes('mystery') || lastPara.includes('star') || lastPara.includes('universe'))) score += 0.5;
    }

    // No filler: every paragraph should have imagery or insight
    const paragraphs = allText.split('\n\n').filter(p => p.trim().length > 20);
    let fillerParas = 0;
    for (const para of paragraphs) {
        const hasImagery = /\b(like|as|metaphor|symbol|image|light|dark|shadow|fire|water|earth|air|wind|storm|calm|depth|height)\b/i.test(para);
        const hasInsight = /\b(realize|understand|see|know|recognize|discover|reveal|truth|meaning|purpose)\b/i.test(para);
        if (!hasImagery && !hasInsight) fillerParas++;
    }
    if (fillerParas === 0) score += 1;
    else if (fillerParas <= 1) score += 0.5;
    else score -= fillerParas * 0.5;

    return clampScore(score);
}

/**
 * Clamps score to 1-10 range with one decimal precision
 */
function clampScore(score) {
    const clamped = Math.max(1, Math.min(10, score));
    return Math.round(clamped * 10) / 10;
}

/**
 * Escapes regex metacharacters so user-provided strings are safe in RegExp.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Identifies strengths based on high scores and specific textual evidence
 */
function identifyStrengths(sections, scores, reasoningPlan) {
    const strengths = [];

    if (scores.recognition >= 8) {
        strengths.push('Opening creates immediate personal recognition.');
    }
    if (scores.traditionAuthenticity >= 8) {
        strengths.push(`Tradition (${reasoningPlan.traditionLens || 'framework'}) remains consistent throughout.`);
    }
    if (scores.literaryQuality >= 8) {
        strengths.push('Prose demonstrates rhythmic variety and sensory imagery.');
    }
    if (scores.emotionalDepth >= 8) {
        strengths.push('Emotional destination reached with specificity, not platitude.');
    }
    if (scores.originality >= 8) {
        strengths.push('Symbolic thread creates distinctive, non-template narrative.');
    }
    if (scores.coherence >= 8) {
        strengths.push('Callbacks unify three sections into a single narrative arc.');
    }
    if (scores.humanFeel >= 8) {
        strengths.push('Voice feels authored, not generated — contractions, fragments, direct address.');
    }
    if (scores.premiumExperience >= 8) {
        strengths.push('Every paragraph earns its place; no filler, cinematic density.');
    }

    // Fallback if no high scores
    if (strengths.length === 0) {
        strengths.push('Reading completes all three required sections.');
    }

    return strengths.slice(0, 5); // Cap at 5
}

/**
 * Identifies weaknesses based on low scores and specific textual evidence
 */
function identifyWeaknesses(sections, scores, reasoningPlan) {
    const weaknesses = [];

    // Truthfulness checks: unsupported palmistry claims (safety-critical, run first)
    const allText = (sections.core + ' ' + sections.love + ' ' + sections.pro).toLowerCase();
    
    const palmLinePatterns = [
        /\bheart\s+line\b/i,
        /\bhead\s+line\b/i,
        /\blife\s+line\b/i,
        /\bfate\s+line\b/i,
        /\bhealth\s+line\b/i,
        /\bsun\s+line\b/i,
        /\bapollo\s+line\b/i,
        /\bmercury\s+line\b/i,
        /\bintuition\s+line\b/i,
        /\bmarriage\s+line\b/i,
        /\bgirdle\s+of\s+venus\b/i,
        /\bring\s+of\s+solomon\b/i,
        /\bsimian\s+line\b/i,
        /\btransverse\s+crease\b/i
    ];
    for (const pattern of palmLinePatterns) {
        if (pattern.test(allText)) {
            weaknesses.push('Claims a specific palm line without verified evidence.');
            break;
        }
    }

    const mountPatterns = [
        /\bvenus\s+mount\b/i,
        /\bjupiter\s+mount\b/i,
        /\bsaturn\s+mount\b/i,
        /\bmercury\s+mount\b/i,
        /\bmoon\s+mount\b/i,
        /\bmars\s+mount\b/i,
        /\bapollo\s+mount\b/i,
        /\bneptune\s+mount\b/i,
        /\bpluto\s+mount\b/i
    ];
    for (const pattern of mountPatterns) {
        if (pattern.test(allText)) {
            weaknesses.push('Claims a palm mount without verified evidence.');
            break;
        }
    }

    const guaranteePatterns = [
        /\byou\s+will\s+(meet|marry|find|get|become|have|receive)\b/i,
        /\bguaranteed\b/i,
        /\bcertainly\s+will\b/i,
        /\bproves\s+you\s+will\b/i,
        /\bpalm\s+proves\b/i,
        /\bpalm\s+indicates\s+(longevity|health|disease|anxiety|depression)\b/i
    ];
    for (const pattern of guaranteePatterns) {
        if (pattern.test(allText)) {
            weaknesses.push('Contains guaranteed prediction or medical/scientific claim unsupported by evidence.');
            break;
        }
    }

    if (scores.recognition < 7) {
        weaknesses.push('CORE section lacks personal specificity — generic addressing.');
    }
    if (scores.traditionAuthenticity < 7) {
        weaknesses.push(`Tradition vocabulary (${reasoningPlan.traditionLens || 'framework'}) absent or inconsistent.`);
    }
    if (scores.literaryQuality < 7) {
        weaknesses.push('Sentence rhythm monotonous; imagery sparse or clichéd.');
    }
    if (scores.emotionalDepth < 7) {
        weaknesses.push('Emotional language generic; destination not reached.');
    }
    if (scores.originality < 7) {
        weaknesses.push('Relies on stock astrology phrases; symbolic thread not developed.');
    }
    if (scores.coherence < 7) {
        weaknesses.push('Sections feel disconnected; callbacks missing or weak.');
    }
    if (scores.humanFeel < 7) {
        weaknesses.push('Voice robotic — no contractions, hedging language, enumerator structure.');
    }
    if (scores.premiumExperience < 7) {
        weaknesses.push('Filler paragraphs present; length imbalanced; closing mood unmet.');
    }

    // Specific textual checks
    if ((sections.core || '').trim().length < 100) {
        weaknesses.push('CORE section too brief for Recognition stage.');
    }
    if ((sections.love || '').trim().length < 100) {
        weaknesses.push('LOVE section too brief for Reflection stage.');
    }
    if ((sections.pro || '').trim().length < 100) {
        weaknesses.push('PRO section too brief for Hope→Calm stage.');
    }

    return weaknesses.slice(0, 5); // Cap at 5
}

/**
 * Generates actionable rewrite targets from weaknesses
 */
function generateRewriteTargets(sections, scores, weaknesses, reasoningPlan) {
    const targets = [];

    // Map weaknesses to specific sections and improvements
    for (const weakness of weaknesses) {
        let target = null;

        if (weakness.includes('CORE section lacks personal specificity') || weakness.includes('CORE section too brief')) {
            target = {
                section: 'CORE',
                problem: 'Generic addressing; insufficient personal recognition',
                improvement: `Integrate user's name naturally 2+ times; reference birth details; anchor ${reasoningPlan.coreFocus || 'central theme'} in personal specifics`
            };
        } else if (weakness.includes('LOVE section too brief') || weakness.includes('Emotional language generic')) {
            target = {
                section: 'LOVE',
                problem: 'Insufficient emotional specificity; Reflection stage underdeveloped',
                improvement: `Deepen ${reasoningPlan.loveFocus || 'emotional exploration'}; use sensory language; avoid platitudes; target ${reasoningPlan.emotionalDestination || 'emotional destination'}`
            };
        } else if (weakness.includes('PRO section too brief') || weakness.includes('closing mood unmet')) {
            target = {
                section: 'PRO',
                problem: 'Hope→Calm stage truncated; closing mood not achieved',
                improvement: `Expand ${reasoningPlan.proFocus || 'forward-looking guidance'}; land ${reasoningPlan.closingMood || 'closing mood'}; callback to CORE via ${reasoningPlan.callbackStrategy?.proToCore || 'core theme'}`
            };
        } else if (weakness.includes('Tradition vocabulary') || weakness.includes('Tradition (') ) {
            target = {
                section: 'ALL',
                problem: 'Tradition framework not authentically applied',
                improvement: `Infuse ${reasoningPlan.traditionLens || 'tradition-specific'} terminology across all sections; use ${reasoningPlan.symbolicThread || 'symbolic thread'} in tradition-appropriate way`
            };
        } else if (weakness.includes('Sentence rhythm monotonous') || weakness.includes('imagery sparse')) {
            target = {
                section: 'ALL',
                problem: 'Literary quality below premium bar',
                improvement: 'Vary sentence length; add 3+ original metaphors/similes; incorporate sensory language; match literary style: ' + (reasoningPlan.literaryStyle || 'poetic directness')
            };
        } else if (weakness.includes('Sections feel disconnected') || weakness.includes('callbacks missing')) {
            target = {
                section: 'ALL',
                problem: 'Narrative coherence broken; callbacks not executed',
                improvement: `Implement callback strategy: CORE→LOVE via "${reasoningPlan.callbackStrategy?.coreToLove || 'theme'}", LOVE→PRO via "${reasoningPlan.callbackStrategy?.loveToPro || 'thread'}", PRO→CORE via "${reasoningPlan.callbackStrategy?.proToCore || 'return'}"`
            };
        } else if (weakness.includes('Voice robotic') || weakness.includes('hedging language')) {
            target = {
                section: 'ALL',
                problem: 'Synthetic voice; lacks human idiosyncrasy',
                improvement: 'Add contractions; use direct address; include 1-2 rhetorical questions; remove hedging phrases; allow sentence fragments for effect'
            };
        } else if (weakness.includes('Filler paragraphs') || weakness.includes('length imbalanced')) {
            target = {
                section: 'ALL',
                problem: 'Premium density not achieved; filler or bloat present',
                improvement: 'Cut paragraphs without imagery or insight; ensure 600-1500 words total; every sentence must carry metaphor, insight, or narrative momentum'
            };
        } else if (weakness.includes('Relies on stock astrology phrases') || weakness.includes('symbolic thread not developed')) {
            target = {
                section: 'ALL',
                problem: 'Originality compromised by clichés; symbolic thread absent',
                improvement: `Replace all stock phrases with ${reasoningPlan.symbolicThread || 'fresh imagery'}; develop supporting themes: ${(reasoningPlan.supportingThemes || []).join(', ')}`
            };
        } else if (weakness.includes('Claims a specific palm line without verified evidence')) {
            target = {
                section: 'ALL',
                problem: 'Unsupported palm line claim',
                improvement: 'Remove any reference to named palm lines (heart, head, life, fate, etc.) unless they were explicitly supplied as verified evidence. Replace with geometry-grounded or tradition-grounded language.'
            };
        } else if (weakness.includes('Claims a palm mount without verified evidence')) {
            target = {
                section: 'ALL',
                problem: 'Unsupported palm mount claim',
                improvement: 'Remove any reference to palm mounts unless explicitly supplied as verified evidence. Replace with geometry-grounded or tradition-grounded language.'
            };
        } else if (weakness.includes('Contains guaranteed prediction or medical/scientific claim')) {
            target = {
                section: 'ALL',
                problem: 'Unsupported prediction or medical/scientific claim',
                improvement: 'Remove guarantees, predictions, and medical/scientific claims. Reframe as reflective possibility within the selected tradition.'
            };
        }

        if (target) {
            targets.push(target);
        }
    }

    // Deduplicate by section+problem
    const seen = new Set();
    const uniqueTargets = [];
    for (const t of targets) {
        const key = t.section + '|' + t.problem;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueTargets.push(t);
        }
    }

    return uniqueTargets.slice(0, 4); // Cap at 4 targets
}

/**
 * Generates one-paragraph review summary
 */
function generateReviewSummary(overallScore, passed, strengths, weaknesses, tradition) {
    const qualityTier = overallScore >= 9 ? 'premium' : overallScore >= 7.5 ? 'strong' : overallScore >= 6 ? 'adequate' : 'needs revision';
    const status = passed ? 'passes quality gate' : 'requires rewrite';
    
    const strengthNote = strengths.length > 0 ? strengths[0].toLowerCase().replace('.', '') : 'completes all sections';
    const weaknessNote = weaknesses.length > 0 ? weaknesses[0].toLowerCase().replace('.', '') : 'no critical flaws';
    
    return `Reading scores ${overallScore}/10 (${qualityTier}) and ${status} for ${tradition} tradition. ${strengthNote.charAt(0).toUpperCase() + strengthNote.slice(1)}; however, ${weaknessNote}. ${passed ? 'Ready for delivery.' : 'Targeted rewrites recommended on flagged sections.'}`;
}

module.exports = {
    reviewReading
};