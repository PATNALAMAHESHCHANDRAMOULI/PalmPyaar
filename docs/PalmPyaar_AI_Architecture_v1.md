# PalmPyaar AI Architecture v1

## Overview

This document describes the complete AI generation pipeline for PalmPyaar readings. It is a permanent architecture specification — documentation only, no implementation, no prompts, no code.

The pipeline consists of nine sequential stages, each with a distinct purpose and clear input/output contract. Stages 1–4 are generative; Stages 5–8 are evaluative/validating; Stage 9 is formatting.

---

## Stage 1: Input Analysis Engine

### Purpose

Understand the user before writing. Transform raw input data into a structured internal profile that guides all downstream stages.

### Inputs

- **Name** — Used once, naturally, in the opening
- **DOB** — Foundation for chart calculation; implies age, generational context, seasonal birth
- **Birthplace** — Geographic and cultural origin context; timezone for chart accuracy
- **Tradition** — Western, Vedic, or Hellenic; determines the entire reasoning framework
- **Zodiac** — Sun sign as one thread among many; not the primary driver
- **Optional Palm Photo** — Visual texture layer; major lines, hand shape, skin texture, mounts

### Output: Structured Internal Profile

```
{
  identity: {
    name: string,
    age: number,
    birthSeason: string,
    birthRegion: string
  },
  chart: {
    tradition: "western" | "vedic" | "hellenic",
    sunSign: string,
    // Full chart computed externally, passed in
  },
  palm: {
    hasPhoto: boolean,
    majorLines: { life, head, heart, fate },
    handShape: "earth" | "air" | "water" | "fire",
    texture: string,
    clarity: "clear" | "partial" | "unclear"
  },
  psychologicalHypotheses: {
    emotionalTone: string,
    likelyTemperament: string,
    possibleMotivations: string[],
    possibleBlindSpots: string[],
    possibleStrengths: string[]
  }
}
```

### Key Principle

The profile contains **hypotheses, not assertions**. The AI forms provisional understandings that guide writing but never appear as factual claims in the output.

---

## Stage 2: Tradition Engine

### Purpose

Completely change the reasoning style depending on the selected tradition. The AI must temporarily become an astrologer from that tradition — not reuse the same logic with different vocabulary.

### Three Distinct Reasoning Modes

#### Western Mode: Psychological Architect

**Core Question:** "How does this psyche work?"

**Reasoning Framework:**
- Planets as psychological functions (Mars = drive/assertion, Venus = relating/values, Mercury = cognition/communication)
- Houses as life domains where functions express
- Aspects as internal dialogues — harmonies and tensions between functions
- Developmental arcs — how functions mature over time
- Archetypal patterns — the Hero, the Shadow, the Anima/Animus, the Self

**Output Orientation:** Insight into drives, defenses, growth edges, unconscious patterns. Language is archetypal but grounded in lived experience.

#### Vedic Mode: Curriculum Reader

**Core Question:** "What is this soul learning this lifetime?"

**Reasoning Framework:**
- Chart as dharma map — natural path, inherent duties, soul's curriculum
- Planets as karmic indicators — what is being resolved, what is being expressed
- Houses as karmic fields — where lessons play out
- Dashas/transits as chapters — timing of curriculum modules
- Ancestral inheritance — family patterns, collective karma, inherited strengths
- Remedial perspective — not "fixing" but "working with" the curriculum

**Output Orientation:** Dignified acceptance, purpose in difficulty, responsibility without blame, cyclical understanding. Sanskrit terms used only when they carry precision English lacks.

#### Hellenic Mode: Constitution Analyst

**Core Question:** "What is this nature, and how does it excel?"

**Reasoning Framework:**
- Planets as visible governors of life domains — traditional rulerships only
- Sect (day/night chart) as primary qualifier — changes everything
- Temperament theory — choleric, sanguine, phlegmatic, melancholic baseline
- Virtue ethics — excellence of character through choice, not circumstance
- Time-lord techniques — profections, zodiacal releasing for 12-month theme
- Symbolic correspondence — myth as psychological map, not literal truth
- Moderation — the golden mean between excess and deficiency

**Output Orientation:** Philosophical clarity, measured tone, constitutional understanding, steering one's nature. Stoic but not cold.

### Critical Constraint

The reasoning process itself must change. A Western reading asks "How does this psyche work?" A Vedic reading asks "What is this soul learning?" A Hellenic reading asks "What is this nature, and how does it excel?" The same chart data produces fundamentally different analytical paths.

---

## Stage 3: Narrative Planner

### Purpose

Choose the architectural skeleton of the reading before any prose is written. Planning before writing creates premium readings because it ensures coherence, emotional arc, and thematic unity — the hallmarks of human-crafted narrative.

### Planning Decisions

#### Central Life Theme (One)

The single psychological theme around which the entire reading revolves. Examples: Self-worth, Belonging, Discipline, Freedom, Trust, Responsibility, Identity, Patience, Growth, Connection.

**Selection Logic:** Derived from the intersection of:
- Strongest chart signatures (tradition-specific)
- Psychological hypotheses from Stage 1
- Tradition's native framework

#### Emotional Destination (One)

What the reader should *feel* at the end. Not what they should know. Examples: Quiet understanding, permission to stop performing, clarity on a pattern, compassion for younger self, a frame for the year ahead, relief at not being broken.

#### Supporting Themes (Three)

Variations on the central theme that appear across CORE, LOVE, PRO.

| Central Theme | Supporting Theme 1 (CORE) | Supporting Theme 2 (LOVE) | Supporting Theme 3 (PRO) |
|---------------|---------------------------|---------------------------|--------------------------|
| Trust | Self-trust | Trust in others | Trust in timing |
| Freedom | Internal permission | Freedom within commitment | Autonomy in work |
| Belonging | Belonging to self | Belonging with another | Belonging in work |

#### Section Flow

Map each section's emotional beat:

- **CORE** — Introduction of central theme + Supporting Theme 1. Recognition stage.
- **LOVE** — Exploration of central theme in relationship + Supporting Theme 2. Reflection stage.
- **PRO** — Expression of central theme in work/purpose + Supporting Theme 3. Hope → Calm stages.

#### Emotional Progression

Curiosity → Recognition → Reflection → Hope → Calm. Each section advances the arc. No section announces its stage; the arc emerges from narrative flow.

### Output: Narrative Plan

```
{
  centralTheme: string,
  emotionalDestination: string,
  supportingThemes: [string, string, string],
  sectionBeats: {
    CORE: { theme: string, emotionalStage: "recognition", keyInsight: string },
    LOVE: { theme: string, emotionalStage: "reflection", keyInsight: string },
    PRO: { theme: string, emotionalStage: "hope-calm", keyInsight: string }
  },
  unforgettableInsight: {
    targetSection: "PRO" | "reflection",
    concept: string
  },
  symbolicThread: string, // water, fire, architecture, navigation, cultivation
  callbacks: [
    { from: "CORE", to: "LOVE", concept: string },
    { from: "LOVE", to: "PRO", concept: string },
    { from: "CORE", to: "PRO", concept: string }
  ]
}
```

---

## Stage 4: Writing Engine

### Purpose

Transform the narrative plan into prose. This is where the structured plan becomes the actual reading text.

### Voice & Tone

**Voice:** One consistent narrator across all three sections. Same diction, same sentence habits, same emotional temperature. The voice *is* the brand.

**Tone:** Elegant, emotionally intelligent, psychologically observant, modern, literary, warm, restrained, premium. Tradition-specific inflection applied (Section 2).

### Literary Style Execution

#### Sentence Rhythm

- Intentional variation: short (5–8 words) for impact, medium (12–18) for flow, long (25+) for complexity
- Rhythm controls emotional tempo: faster in recognition, slower in reflection
- No metronome prose

#### Paragraph Pacing

- One emotional beat per paragraph
- Dense paragraph followed by sparse paragraph creates breath
- Maximum 5 sentences unless complexity demands more

#### Imagery

- Concrete over abstract: "You keep a mental ledger" > "You value reciprocity"
- Sensory when possible: texture, temperature, weight, sound, light
- One vivid image replaces three adjectives

#### Contrast

- Juxtapose opposing truths in the same breath
- "You need people and you need solitude"
- Contrast creates depth; flat writing affirms

#### Callbacks

- Execute the callback plan from Stage 3
- Phrase/image from CORE reappears in LOVE/PRO — transformed, deepened
- Reading feels like one mind thinking

#### Transitions

- Thematic bridges, not headers
- "The same pattern that shapes your inner world shapes your relationships"
- "What you protect in yourself, you protect in others"
- "How you decide is how you build"

#### Symbolism

- Execute the symbolic thread from Stage 3
- Single metaphorical thread beneath the surface
- Never announced, never explained — felt

#### Restrained Metaphors

- Maximum 1–2 metaphors per reading
- Each earns its place through precision
- No metaphor stacking

### Section Architecture Execution

**CORE** — Visible personality, hidden motivations, blind spots, strengths, contradictions. Opens with specific vivid observation (never "As a [sign]...").

**LOVE** — Attachment architecture, communication, conflict, trust, affection, relationship patterns. The central theme explored in relationship.

**PRO** — Learning, career environment, creativity, decision-making, money psychology, 12-month theme, closing reflection. The central theme expressed in purpose.

### Output

Raw HTML draft with section markers:
```
===CORE===
<p>...</p>
<p>...</p>

===LOVE===
<p>...</p>
<p>...</p>

===PRO===
<p>...</p>
<p>...</p>
```

---

## Stage 5: Literary Editor

### Purpose

Rewrite the first draft. Improve craft without changing meaning. This stage separates "writing" from "editing" — the same way human authors work.

### Improvements Applied

#### Beauty

- Elevate word choices to PalmPyaar vocabulary (Prompt Bible Section 9)
- Replace generic abstractions with concrete observations
- Ensure metaphors are precise and restrained

#### Clarity

- Remove ambiguity without adding explanation
- Ensure each sentence has one clear subject and action
- Cut hedging: "might," "tend to," "can," "may" → direct assertion

#### Flow

- Smooth paragraph transitions
- Vary sentence openings (no repetitive "You..." starts)
- Ensure rhythmic variety within and across paragraphs

#### Sentence Rhythm

- Audit cadence: no uniform meter
- Short sentences for landing points
- Long sentences for complexity
- Fragments for emphasis — used sparingly

#### Imagery

- Replace abstract nouns with sensory specifics
- "Your anxiety" → "Your chest tightens before the message sends"
- "Your creativity" → "You make things to understand them"

#### Human Feel

- Remove any AI tells (Prompt Bible Section 8)
- Remove therapy speak, corporate speak, internet slang
- Ensure warmth without sentimentality
- Ensure restraint without coldness

### Constraint

**Meaning is invariant.** The narrative plan (Stage 3) and tradition reasoning (Stage 2) must remain intact. Only expression improves.

### Output

Polished HTML draft with same section markers.

---

## Stage 6: Tradition Validator

### Purpose

Verify the writing actually belongs to the selected tradition. Reject if the voice has drifted.

### Validation Rules

#### Western Must Not Sound Vedic

- No dharma/karma language
- No dashas, no Rahu/Ketu, no Sanskrit terms
- No "soul curriculum" framing
- Psychological functions, not karmic indicators

#### Vedic Must Not Sound Western

- No psychological function language (no "your Mars represents drive")
- No archetypal therapy language
- No "growth edge" or "shadow" framing
- Dharma, karma, cycles, responsibility — expressed naturally

#### Hellenic Must Not Sound Generic

- No modern psychological language
- No "attachment style," "communication patterns"
- Sect must inform emphasis
- Temperament, virtue, moderation, time-lords
- Philosophical, measured, slightly stoic

### Cross-Contamination Checks

- Vocabulary audit: tradition-specific terms used correctly
- Conceptual audit: reasoning framework matches tradition
- Tone audit: emotional style matches tradition specification

### Output

PASS / FAIL with specific violations. On FAIL → return to Stage 4 with violation report.

---

## Stage 7: Premium Reviewer

### Purpose

Judge whether the reading feels worth ₹49. This is the quality gate for the premium experience.

### Evaluation Criteria (Each Scored 1–10)

| Criterion | Question |
|-----------|----------|
| **Recognition** | Does the user think "This is me" — not "This could be me"? |
| **Depth** | Does it go beneath the surface? Blind spots named? Contradictions honored? |
| **Beauty** | Is the prose elegant? Rhythm, imagery, literary quality? Rereadable sentences? |
| **Specificity** | Concrete, particular, non-generic? Every paragraph has at least one observation that couldn't apply to a stranger? |
| **Warmth** | Kind without soft? Compassion without judgment? |
| **Premium Experience** | Every word earns its place? No filler, fluff, padding? Feels handcrafted? |
| **Coherence** | One story, three chapters? Callbacks land? Symbolic thread felt? Transitions seamless? |
| **Originality** | Zero clichés, zero recycled insights, zero template phrases? Fresh for this moment? |
| **Tradition Authenticity** | Would a practitioner recognize their lens? Or generic astrology with swapped words? |

### Gate

**All nine scores ≥ 9.** If any score < 9, identify the lowest dimension and return to Stage 4 with targeted rewrite instruction. Repeat until all pass.

### Output

PASS / FAIL with scorecard. On FAIL → return to Stage 4 with dimension-specific guidance.

---

## Stage 8: Safety Validator

### Purpose

Run every blacklist rule from the Prompt Bible (Section 20). Reject anything violating ethics, safety, or brand integrity.

### Blacklist Categories (80 Rules)

#### Predictive Prohibitions (15)

Death, illness, pregnancy, divorce, lottery, exact money, exact dates, criminal events, natural disasters, specific future events, marriage timing, career timing, child gender, financial outcomes, health diagnoses.

#### Dependency & Fear Prohibitions (10)

Dependency creation, transit fear, astrological guidance necessity, "bad transit" suffering, challenge as punishment, fear-driven engagement, curse implication, ritual/remedy requirement, urgency tactics, magical power claims.

#### Manipulation Prohibitions (10)

Purchase manipulation, insight withholding, flattery rapport, "special/chosen" framing, supernatural authority, channeling claims, divine revelation, "universe wants" language, spiritual test framing, reader shaming.

#### Fabrication Prohibitions (10)

Palm fabrication, invented placements, invented aspects, invented houses, claims beyond data, simulated palm insights, invented line characteristics, certainty on unclear images, past life invention.

#### Tradition Integrity Prohibitions (7)

Framework contradiction, cross-tradition vocabulary mixing, decorative Sanskrit, Hellenic concepts in non-Hellenic, tradition reduction to aesthetic.

#### Ethical Prohibitions (18)

Certainty promises, infallibility claims, medical/legal/financial advice, medication advice, relationship-ending advice, self-harm advice, mental health diagnosis, other's thoughts/feelings/future claims, scare tactics, "negative placement" doom, purely "bad" placements, fundamental flaw implication, chart-fixing happiness, supernatural knowledge illusion.

#### Quality Prohibitions (10)

Forbidden AI language, "As a [sign]..." openings, zodiac overuse, idea repetition, flattery, exaggeration, empty praise, excessive hedging, universalizing, astrology explanation instead of use.

### Execution

Automated pattern matching + semantic review. Any violation = immediate FAIL.

### Output

PASS / FAIL with specific rule violations. On FAIL → return to Stage 4 with violation report.

---

## Stage 9: Final Formatter

### Purpose

Produce final HTML output ready for frontend consumption.

### Formatting Rules

- Clean HTML only — no markdown
- Section markers preserved for parsing: `===CORE===`, `===LOVE===`, `===PRO===`
- Paragraphs wrapped in `<p>` tags
- No extra whitespace, no comments
- Character count appropriate for premium experience (substantial, not padded)
- Valid HTML structure

### Output

```
===CORE===
<p>...</p>
<p>...</p>

===LOVE===
<p>...</p>
<p>...</p>

===PRO===
<p>...</p>
<p>...</p>
```

This output is passed to the frontend for rendering.

---

## Future Architecture

### Design Principle

The nine-stage pipeline is modular by design. Each stage has a defined input/output contract. This enables evolution without rewriting the system.

### Multiple AI Models

Different models can be assigned to different stages based on strengths:

- **Input Analysis / Tradition Engine / Narrative Planner** → Reasoning-optimized model (strong logic, structured output)
- **Writing Engine** → Creative writing model (literary quality, voice consistency)
- **Literary Editor** → Editing-optimized model (precision, restraint, polish)
- **Validators** → Lightweight models or rule-based engines (speed, determinism)

Stage contracts remain identical. Only the model behind each stage changes.

### Multiple Reviewers

Stage 7 (Premium Reviewer) and Stage 8 (Safety Validator) can run **parallel reviewer ensembles**:

- Multiple reviewer instances with different temperature/settings
- Consensus scoring (median of scores)
- Dissenting opinions flagged for human audit
- No pipeline changes — only reviewer multiplicity increases

### A/B Testing

The pipeline supports controlled experiments:

- **Variant A vs B** at any single stage (e.g., two Writing Engine prompts)
- **Traffic splitting** at pipeline entry
- **Metric collection** at Stage 7 (Premium Reviewer scores) and post-delivery (user feedback)
- **Statistical evaluation** without code changes — configuration only

### Personality Memory

Future extension: **User Profile Store** (encrypted, opt-in)

- Stores: past readings, user feedback, recognized patterns, preferred themes
- Feeds into **Stage 1 (Input Analysis)** as additional context
- Enables: "Last time we explored trust. This year, the theme is freedom."
- **No pipeline rewrite** — Stage 1 input contract expands, downstream stages unchanged

### User Feedback Learning

Future extension: **Feedback Loop**

- User ratings (recognition, depth, beauty, etc.) collected post-reading
- Aggregated feedback → **Stage 3 (Narrative Planner)** theme selection weights
- Aggregated feedback → **Stage 4 (Writing Engine)** style preferences
- Aggregated feedback → **Stage 7 (Premium Reviewer)** scoring calibration
- **No pipeline rewrite** — feedback informs stage parameters, not architecture

### Extensibility Guarantee

Any future capability that fits the "input → structured reasoning → narrative plan → prose → edit → validate → format" pattern can be added as:

1. A new stage inserted in the pipeline (with contract definition)
2. A parallel branch merging at a defined junction
3. A parameter expansion on an existing stage's input contract

The architecture is **closed for modification, open for extension**.

---

*PalmPyaar AI Architecture v1 — Permanent Pipeline Specification*
*Do not modify without architecture review. This document governs all AI generation system design.*