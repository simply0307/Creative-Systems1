# EGGS / Para Creative Archive — Remediation Backlog

Version: 0.1  
Status: Working backlog; priorities are recommendations until approved  
Scope: Archive repair and preparation only. App implementation is explicitly deferred.

## How to use this backlog

- Work from critical to low priority, respecting decision and dependency gates.
- Preserve raw source files. Remediation normally creates corrected records or successor documents rather than rewriting historical artifacts.
- “Needs user decision: Yes” means drafting or analysis may proceed, but the proposed change cannot be adopted as canon or product policy without approval.
- App tasks define later build requirements. They are not authorization to build the app now.
- Close an item only when its named output exists and any required decision has been recorded.

Work types used below: `writing`, `data`, `app`, `canon decision`, and `legal/design guardrail`. Multiple types may apply.

## Recommended execution sequence

1. Resolve blocking vocabulary, authority, and product-risk decisions.
2. Classify every source artifact without promoting it to canon.
3. Rewrite principle and convergence definitions for reliable reuse.
4. Audit mortal civilizations and historical transcription.
5. Define player-facing translations and Para Poker guardrails.
6. Establish provenance, rights, and visual review.
7. Prepare clean migration data and app requirements.

---

## 1. Foundation / Vocabulary Issues

### FND-01 — Resolve ecosystem name hierarchy

- **Problem:** EGGS, Para, Paralleon, Reath, Mythic Strategies, Egghead University, and the competitive circuit are used as brands, worlds, products, and community spaces without one stable relationship model.
- **Why it matters:** Future records and projects cannot be scoped reliably if “world,” “game,” “brand,” and “community” are interchangeable.
- **Affected concepts/files:** `Index/readme.txt`; `Archive/Prose/EGGS MDP (1).pdf`; `Archive/Prose/THE EGGS MS WHOLISTIC DESIGNER ETHICS CODEX.pdf`; all project records.
- **Recommended fix:** Draft a one-page hierarchy defining owner brand, creative universe, setting, game/product, community program, and commercial venue. Record aliases and deprecated uses.
- **Priority:** Critical
- **Output needed:** Approved ecosystem map and glossary entries.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### FND-02 — Separate “faction” into precise entity types

- **Problem:** “Faction” currently refers to alien principles, mortal civilizations, player identities, organizations, and browsing categories.
- **Why it matters:** This flattening obscures the system's strongest distinction and will produce confused app data and player messaging.
- **Affected concepts/files:** All `what are *.txt` files; `alien principle.txt`; index `Faction` column; future faction pages.
- **Recommended fix:** Define controlled subtypes: alien principle, mortal civilization, organization, player affiliation, and project faction. Keep “Faction” only as an optional umbrella label in UI.
- **Priority:** Critical
- **Output needed:** Controlled vocabulary and migration mapping for current faction labels.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes

### FND-03 — Normalize core term spellings and aliases

- **Problem:** The archive uses Zynarth/Xynarth and Zendra/Xen’Dra inconsistently; other names also vary in capitalization.
- **Why it matters:** Naming drift breaks search, relationships, data imports, and player recognition.
- **Affected concepts/files:** `what are xynarth.txt`; `what are zendra.txt`; `zendrapoem.txt`; `what are morphlings.txt`; diagnostic and foundation documents.
- **Recommended fix:** Create a canonical-name and alias registry. Preserve original spellings inside source artifacts but normalize indexed entities and search aliases.
- **Priority:** Critical
- **Output needed:** Approved naming decision and alias table.
- **Work type:** Data; canon decision
- **Needs user decision before proceeding:** Yes

### FND-04 — Define minimum meaningful archive reuse

- **Problem:** Every EGGS game should draw from the archive, but the threshold between meaningful derivation and decorative reference is unclear.
- **Why it matters:** Without a test, the archive will either be forced into every project or reduced to cosmetic name-dropping.
- **Affected concepts/files:** `Index/readme.txt`; `ARCHIVE_FOUNDATION_SPEC.md`; all future project briefs.
- **Recommended fix:** Require each project to document at least one material derivation with a source concept, translation mode, player promise, and evidence. Permit intentional omissions.
- **Priority:** High
- **Output needed:** Project reuse checklist and approval criterion.
- **Work type:** Writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### FND-05 — Define boundaries of the three-principle grammar

- **Problem:** The principles are described as always present and as defining what can happen, which risks making the system totalizing and unfalsifiable.
- **Why it matters:** Designers need freedom to use one principle, omit a principle, or recognize influences outside the triad.
- **Affected concepts/files:** `alien principle.txt`; all alien-principle files; `ARCHIVE_FOUNDATION_SPEC.md`.
- **Recommended fix:** Add explicit non-claims: principles are interpretive/design lenses, not mandatory explanations; `not applicable` and intentional absence are valid.
- **Priority:** High
- **Output needed:** Foundation clarification and examples of valid partial use.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

---

## 2. Canon Status Issues

### CAN-01 — Classify every current prose and PDF artifact

- **Problem:** Raw notes, polished essays, ethics guidance, product strategy, and project lore currently sit together without authority labels.
- **Why it matters:** File presence may be mistaken for canon or approved product policy.
- **Affected concepts/files:** All files in `Archive/Prose`; `Index/readme.txt`.
- **Recommended fix:** Assign each artifact a layer, authority status, review flags, project scope, and short rationale. Default to flexible inspiration or experimental unless explicitly approved.
- **Priority:** Critical
- **Output needed:** Artifact classification table covering every prose/PDF file.
- **Work type:** Data
- **Needs user decision before proceeding:** No for provisional classification; Yes for canon promotion

### CAN-02 — Separate authority status from review state

- **Problem:** “Canon,” “risky,” “contradictory,” and “needs decision” are being treated as one kind of status.
- **Why it matters:** A concept can be strong direction and risky at the same time; one field cannot express both accurately.
- **Affected concepts/files:** Current index `Status`; future schemas; all archive entities.
- **Recommended fix:** Store `authority_status` separately from `review_flags`, using the enums in `ARCHIVE_FOUNDATION_SPEC.md`.
- **Priority:** Critical
- **Output needed:** Approved status matrix and legacy-status migration rules.
- **Work type:** Data; canon decision
- **Needs user decision before proceeding:** Yes

### CAN-03 — Establish canon promotion and retirement workflow

- **Problem:** No process defines how material becomes foundation canon, project canon, or retired material.
- **Why it matters:** Unreviewed drafts can harden into canon, while rejected ideas may disappear without context.
- **Affected concepts/files:** Entire archive; future app workflows.
- **Recommended fix:** Define approvers, evidence requirements, mandatory decision-log fields, supersession behavior, and restrictions on silent reactivation.
- **Priority:** High
- **Output needed:** Canon governance procedure.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### CAN-04 — Mark superseded and duplicate formulations

- **Problem:** `what are morphlings.txt` contains repeated and expanded formulations, while other concepts recur with wording differences and no version chain.
- **Why it matters:** Designers cannot tell which statement is current or whether differences are meaningful.
- **Affected concepts/files:** `what are morphlings.txt`; alien-principle prose; future successor drafts.
- **Recommended fix:** Extract concept statements into versioned records, mark duplicates, and link superseded passages without deleting sources.
- **Priority:** Medium
- **Output needed:** Version map and duplicate/supersession report.
- **Work type:** Data; writing
- **Needs user decision before proceeding:** No, unless choosing the authoritative formulation

### CAN-05 — Create project-scope boundaries for current lore

- **Problem:** Rumin, Sheen, Bizi, Frumo, Reath, and their timelines are not consistently marked as project-specific.
- **Why it matters:** A setting-specific history may accidentally bind unrelated future games.
- **Affected concepts/files:** All civilization descriptions and timelines; associated art folders.
- **Recommended fix:** Create a provisional Reath/Paralleon project scope and place current civilizations, characters, and timelines inside it pending hierarchy approval.
- **Priority:** High
- **Output needed:** Project-scope assignment table.
- **Work type:** Data; canon decision
- **Needs user decision before proceeding:** Yes for final scope; No for provisional tagging

---

## 3. Faction Clarity Issues

### FAC-01 — Build a faction distinction matrix

- **Problem:** Factions are described richly but not compared through consistent attributes.
- **Why it matters:** Overlap becomes visible only in prose review, and designers lack a reusable differentiation tool.
- **Affected concepts/files:** All principle and civilization descriptions.
- **Recommended fix:** Compare each entity by core pressure, signature verbs, constructive promise, failure mode, institutions, mechanics, player fantasy, motifs, and exclusions.
- **Priority:** High
- **Output needed:** Approved faction/principle distinction matrix.
- **Work type:** Writing; data
- **Needs user decision before proceeding:** No for draft; Yes for approval

### FAC-02 — Define positive player-facing identity for every faction-like entity

- **Problem:** Current descriptions emphasize critique and horror more clearly than honorable identification.
- **Why it matters:** Players cannot safely identify with a label that reads primarily as authoritarian, consumptive, or delusional.
- **Affected concepts/files:** Zynarth, Voltari, Zendra; Rumin, Sheen, Bizi, Frumo; onboarding material in `EGGS MDP (1).pdf`.
- **Recommended fix:** Add an aspirational promise, admired skills, healthy competitive behavior, shadow risk, and non-accusatory profile language to each entity.
- **Priority:** Critical
- **Output needed:** Player-facing identity briefs.
- **Work type:** Writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes for public wording

### FAC-03 — Replace single-faction onboarding with layered affinities

- **Problem:** The MDP suggests choosing a faction, while the creative system says identity is positional and mixed.
- **Why it matters:** A single-team model contradicts the archive's strongest identity idea.
- **Affected concepts/files:** `Archive/Prose/EGGS MDP (1).pdf`; future profiles and onboarding.
- **Recommended fix:** Design an affinity model supporting primary, secondary, evolving, or project-specific identities without compulsory allegiance.
- **Priority:** High
- **Output needed:** Affinity model and revised onboarding copy.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes

### FAC-04 — Define mechanical signatures rather than color/team signatures

- **Problem:** Faction reuse can collapse into names, emblems, or palettes without meaningful behavior.
- **Why it matters:** Cosmetic factioning becomes repetitive and forced across games.
- **Affected concepts/files:** Principle pages; achievement/card concepts; future game briefs.
- **Recommended fix:** Assign each principle and approved expression reusable verbs, resource dynamics, skill tests, and anti-patterns.
- **Priority:** High
- **Output needed:** Mechanical signature sheets.
- **Work type:** Writing; data
- **Needs user decision before proceeding:** No for drafting; Yes for canon approval

---

## 4. Alien Principle Issues

### ALN-01 — Rewrite Zynarth as a complete design principle

- **Problem:** Zynarth is strong conceptually but weighted toward plague, greed, mob behavior, and runaway snowballing.
- **Why it matters:** It needs a durable constructive identity and balanced mechanical applications.
- **Affected concepts/files:** `what are xynarth.txt`; `alien principle.txt`; Morphling examples.
- **Recommended fix:** Produce a canonical-format brief covering core question, verbs, virtues, healthy play fantasy, failure modes, mechanic patterns, exclusions, and cross-genre examples.
- **Priority:** High
- **Output needed:** Zynarth principle specification.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes for approval

### ALN-02 — Rewrite Voltari as a complete design principle

- **Problem:** Voltari is clear but can collapse into generic robot order or authoritarian bureaucracy.
- **Why it matters:** Its positive value—reliability, fairness, discipline, and meaningful rules—must remain usable in competitive design.
- **Affected concepts/files:** `what are voltari.txt`; `alien principle.txt`; Bizi, Sheen, and Rumin descriptions.
- **Recommended fix:** Define precise verbs, constructive competitive expressions, failure modes, exclusions, and genre-independent uses.
- **Priority:** High
- **Output needed:** Voltari principle specification.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes for approval

### ALN-03 — Rewrite Zendra with concrete mechanical verbs

- **Problem:** Zendra is narratively memorable but mechanically less defined and can become generic psychic magic.
- **Why it matters:** Reuse across games requires specific player decisions and information structures.
- **Affected concepts/files:** `what are zendra.txt`; `zendrapoem.txt`; Morphling examples.
- **Recommended fix:** Define verbs such as reveal, conceal, predict, misread, reframe, bluff, and alter interpretation; distinguish information from supernatural spectacle.
- **Priority:** High
- **Output needed:** Zendra principle specification and mechanic map.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes for approval

### ALN-04 — Resolve Voltari “signal” versus Zendra interpretation

- **Problem:** Both principles claim signal-related territory.
- **Why it matters:** Unresolved semantic overlap will blur mechanics, motifs, and hybrid logic.
- **Affected concepts/files:** `what are voltari.txt`; known Zendra direction; foundation documents.
- **Recommended fix:** Assign Voltari transmission protocol, standardization, and legibility; assign Zendra reception, interpretation, meaning, and distortion. Test edge cases.
- **Priority:** High
- **Output needed:** Boundary note with examples and `should_not_be_confused_with` links.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### ALN-05 — Define principle absence, resistance, and agency

- **Problem:** The current cosmology gives little formal room for refusal, chance, or events that resist dominant pressures.
- **Why it matters:** Without resistance, the principles can feel deterministic and narratively airless.
- **Affected concepts/files:** `alien principle.txt`; Astral Vanguard concept; future game translations.
- **Recommended fix:** Define how actors resist, redirect, balance, or remain unreadable to a principle without inventing another principle prematurely.
- **Priority:** Medium
- **Output needed:** Agency and resistance design note.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

---

## 5. Morphling / Convergence Issues

### MOR-01 — Approve Convergence as the abstract hybrid layer

- **Problem:** “Morphling” currently names abstract combinations, beings, identities, and design classifications.
- **Why it matters:** One overloaded term makes schemas and lore ambiguous.
- **Affected concepts/files:** `what are morphlings.txt`; foundation specification; all hybrid examples.
- **Recommended fix:** Use Convergence for abstract combinations and Morphling for embodied expressions, subject to approval.
- **Priority:** Critical
- **Output needed:** Terminology decision and updated definitions.
- **Work type:** Canon decision; writing
- **Needs user decision before proceeding:** Yes

### MOR-02 — Create the three pairwise convergence specifications

- **Problem:** The combinations have evocative phrases but no consistent design records.
- **Why it matters:** They are among the most reusable ideas in the archive and need more than examples.
- **Affected concepts/files:** `what are morphlings.txt`; Rumin, Sheen, Bizi, and Frumo mappings.
- **Recommended fix:** Specify Zynarth–Voltari, Voltari–Zendra, and Zynarth–Zendra using combined verbs, constructive forms, destructive forms, mechanics, motifs, and exclusions.
- **Priority:** High
- **Output needed:** Three convergence briefs.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes for approval

### MOR-03 — Define triple-convergence limits

- **Problem:** Triple hybrids are described as “even stranger,” but their design value and constraints are undefined.
- **Why it matters:** An all-principle category can become a convenient explanation for anything.
- **Affected concepts/files:** `what are morphlings.txt`.
- **Recommended fix:** Define when a triple convergence is justified, what it must demonstrate, and why it is not merely a pile of traits.
- **Priority:** Medium
- **Output needed:** Triple-convergence rule and one approved example.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### MOR-04 — Create a Morphling validation template

- **Problem:** There is no quality test preventing generic shapeshifters or arbitrary mixed creatures from being labeled Morphlings.
- **Why it matters:** Weak Morphlings would rapidly dilute the core hybrid system.
- **Affected concepts/files:** Future characters, cards, factions, and player identities; `what are morphlings.txt`.
- **Recommended fix:** Require component convergence, embodiment logic, stable and variable traits, narrative role, mechanical affordance, and explicit non-generic distinction.
- **Priority:** High
- **Output needed:** Morphling creation/review template.
- **Work type:** Writing; data; legal/design guardrail
- **Needs user decision before proceeding:** No for draft; Yes for adoption

---

## 6. Astral Vanguard Issues

### AVG-01 — Establish Astral Vanguards as a separate ontological layer

- **Problem:** Astral Vanguards are presented alongside alien factions despite serving as outsiders and interpreters rather than principles.
- **Why it matters:** Treating them as a fourth faction breaks the layer model.
- **Affected concepts/files:** `what are morphlings.txt`; `EGGS MDP (1).pdf`; future Vanguard records.
- **Recommended fix:** Define them as cross-world roles or entities linked to projects, interventions, and observations—not as a principle.
- **Priority:** High
- **Output needed:** Astral Vanguard foundation brief and data subtype.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes

### AVG-02 — Define Vanguard roles without moral default

- **Problem:** Vanguards can be saviors, archivists, meddlers, or conquerors, but their operational distinctions are undeveloped.
- **Why it matters:** Without role clarity they risk becoming generic space adventurers or authorial mouthpieces.
- **Affected concepts/files:** `what are morphlings.txt`; `zendrapoem.txt`; MDP request for Vanguard seeds.
- **Recommended fix:** Define role families such as observer, courier, archivist, scout, intervener, and defector, each with consent and power tensions.
- **Priority:** Medium
- **Output needed:** Vanguard role taxonomy and three revised seed examples.
- **Work type:** Writing; data
- **Needs user decision before proceeding:** No for draft; Yes for canon selection

### AVG-03 — Define Vanguard/player relationship

- **Problem:** It is unclear whether Vanguards are lore characters, player avatars, curators, or an interface metaphor.
- **Why it matters:** Each use carries different narrative authority and product implications.
- **Affected concepts/files:** `EGGS MDP (1).pdf`; future onboarding, profiles, archive UI, and games.
- **Recommended fix:** Document allowed usage modes per project and prohibit automatic equivalence between player and benevolent editor of worlds.
- **Priority:** Medium
- **Output needed:** Vanguard usage matrix.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

---

## 7. Mortal Civilization Issues

### CIV-01 — Differentiate Bizi and Sheen structurally

- **Problem:** Both are primarily Voltari–Zendra civilizations involving order, ritual, preservation, legitimacy, and sacred systems.
- **Why it matters:** Their thematic and mechanical identities can blur despite different aesthetics.
- **Affected concepts/files:** `what are bizi.txt`; `what are sheen.txt`; both timelines and art folders.
- **Recommended fix:** Establish Bizi around routing, powering, maintaining, access, and dependency; establish Sheen around inheritance, memory, healing, continuity, and legitimacy. Test conflicts and mechanics.
- **Priority:** High
- **Output needed:** Bizi/Sheen distinction brief and revised signature verbs.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### CIV-02 — Preserve Rumin while removing Rome transcription

- **Problem:** Rumin's “procedural appetite” is strong, but its timeline and names reproduce Roman history closely.
- **Why it matters:** The best civilization concept is being weakened by derivative execution.
- **Affected concepts/files:** `what are rumin.txt`; `rumintimeline.txt`; Rumin art and characters.
- **Recommended fix:** Preserve finance, obligation, civic spectacle, and procedural extraction; redesign institutions, chronology, rulers, conflicts, and symbols from first principles.
- **Priority:** High
- **Output needed:** Rumin concept kernel and transformed timeline brief.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes before replacing current direction

### CIV-03 — Preserve Frumo while removing French Revolutionary transcription

- **Problem:** Frumo's emotional-weather and grief-legitimacy ideas are strong, but names and sequence closely mirror the French Revolution and Napoleon.
- **Why it matters:** Direct transcription creates originality and ethics conflicts.
- **Affected concepts/files:** `what are frumo.txt`; `frumotimline.txt`; Frumo character art.
- **Recommended fix:** Preserve grief economy, tribunals, frozen futurity, and revolutionary corruption; rebuild the political sequence, institutions, figures, and outcomes.
- **Priority:** High
- **Output needed:** Frumo concept kernel and transformed timeline brief.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### CIV-04 — Rebuild Bizi beyond Byzantine/Constantinople analogy

- **Problem:** Bizi's sacred infrastructure is distinctive, but names, empire beats, and imagery lean on Byzantium and recognizable religious architecture.
- **Why it matters:** The direct analogy conflicts with the ethics codex and limits aesthetic originality.
- **Affected concepts/files:** `what are bizi.txt`; `bizitimeline.txt`; Bizi art, especially `Steampunk_constantinople_in_sepiaa.webp`.
- **Recommended fix:** Preserve maintenance-as-prayer, routes, access, Hub dependency, and fuel theology; redesign history, architecture, sacred interface, and names.
- **Priority:** High
- **Output needed:** Bizi concept kernel, transformed timeline, and motif reset brief.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### CIV-05 — Rebuild Sheen beyond imperial-China analogy

- **Problem:** Sheen's rooted memory is strong, but its description explicitly maps to imperial China, examinations, dynasty, and state medicine.
- **Why it matters:** The concept risks flattening a real culture into a critical fantasy device.
- **Affected concepts/files:** `what are sheen.txt`; `sheentimeline.txt`; Sheen art and character names.
- **Recommended fix:** Preserve memory, inherited obligation, healing, continuity, and renewal; redesign governance, kinship, knowledge transmission, and ritual systems.
- **Priority:** High
- **Output needed:** Sheen concept kernel and transformed civilization brief.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### CIV-06 — Classify undeveloped civilizations and folders

- **Problem:** Jali, Mekan, Gracus, and Indela appear in prose or art without enough current definition to establish status.
- **Why it matters:** Unlabeled fragments create false expectations and pollute browsing.
- **Affected concepts/files:** `Archive/Art/jali`; `Archive/Art/mekan`; `Archive/Art/gracus`; mention of Indela in `what are morphlings.txt`.
- **Recommended fix:** Inventory each concept, summarize available evidence, and present options: active development, experimental fragment, merged concept, or retired.
- **Priority:** Medium
- **Output needed:** Unresolved civilization dossier and user decision list.
- **Work type:** Data; writing; canon decision
- **Needs user decision before proceeding:** Yes for classification

---

## 8. Historical Transcription Issues

### HIS-01 — Perform a historical-distance audit

- **Problem:** The archive lacks a repeatable method for determining when inspiration has become transcription.
- **Why it matters:** Similar problems will recur even after current timelines are rewritten.
- **Affected concepts/files:** All civilization descriptions, timelines, names, and visual references; ethics codex.
- **Recommended fix:** Score name similarity, event sequence, institutional equivalence, symbol use, visual mimicry, and trauma proximity. Define blocking thresholds.
- **Priority:** Critical
- **Output needed:** Historical-distance rubric and completed audit of four developed civilizations.
- **Work type:** Writing; data; legal/design guardrail
- **Needs user decision before proceeding:** No for audit; Yes for thresholds

### HIS-02 — Reconcile timelines with the ethics codex

- **Problem:** The ethics codex says “transform, don't transcribe” and rejects reenactment, while current timelines openly follow real histories.
- **Why it matters:** The archive contains a direct internal policy contradiction.
- **Affected concepts/files:** All four timelines; `THE EGGS MS WHOLISTIC DESIGNER ETHICS CODEX.pdf`.
- **Recommended fix:** Flag the timelines as contradictory/risky, create decision links, and either rewrite them or narrow the codex through an explicit decision. Do not leave both unqualified.
- **Priority:** Critical
- **Output needed:** Contradiction resolution decision and remediation plan per timeline.
- **Work type:** Canon decision; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### HIS-03 — Replace historical names and one-to-one figures

- **Problem:** Names such as Kaiser, Brutus, Augustus, Robespier, Lafayette, Hera, and Constantinople-derived terms preserve source identity too directly.
- **Why it matters:** Even public-domain names can make the work feel like parody transcription rather than original worldbuilding.
- **Affected concepts/files:** All civilization timelines; associated character art filenames and metadata.
- **Recommended fix:** Rename only after transformed roles and institutions exist; preserve legacy aliases in source tracking.
- **Priority:** High
- **Output needed:** Character/function mapping followed by an approved naming pass.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes for final names

### HIS-04 — Define acceptable historical research use

- **Problem:** The archive critiques real systems but lacks a standard for research, transformation, and attribution.
- **Why it matters:** Avoiding all history would make the work shallow; copying it would make the work derivative.
- **Affected concepts/files:** Ethics codex; future civilization and commentary work.
- **Recommended fix:** Create a research protocol emphasizing multiple sources, system-level synthesis, transformed causality, cultural sensitivity, and separation between commentary and fiction.
- **Priority:** Medium
- **Output needed:** Historical inspiration protocol.
- **Work type:** Writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes for adoption

---

## 9. Player Identity Issues

### PID-01 — Create constructive identity language for the principles

- **Problem:** Principle descriptions work better as critiques than as identities players would proudly display.
- **Why it matters:** Player affiliation must create aspiration and meaning rather than moral suspicion.
- **Affected concepts/files:** All alien-principle files; onboarding and profile concepts.
- **Recommended fix:** Write player promises, healthy behaviors, competitive strengths, honorable rivalries, and self-aware shadow risks for each principle.
- **Priority:** Critical
- **Output needed:** Three approved player identity cards.
- **Work type:** Writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### PID-02 — Prohibit diagnostic and accusatory labels

- **Problem:** Terms associated with authoritarianism, mob guilt, paranoia, cults, and delusion could be applied directly to players.
- **Why it matters:** This can alienate players and turn symbolic systems into personality judgments.
- **Affected concepts/files:** Future quizzes, profiles, archetypes, achievements, moderation language, marketing.
- **Recommended fix:** Create prohibited-language and safe-framing guidance. Describe observable play styles, not mental health, morality, or political identity.
- **Priority:** High
- **Output needed:** Player identity language guardrail.
- **Work type:** Legal/design guardrail; writing
- **Needs user decision before proceeding:** No for draft; Yes for adoption

### PID-03 — Design affinities as earned, chosen, and revisable

- **Problem:** Identity assignment mechanics are undefined.
- **Why it matters:** A quiz or automated label could feel deterministic, while purchasable identity could feel hollow.
- **Affected concepts/files:** MDP onboarding; future profiles and games.
- **Recommended fix:** Define how identities can be chosen, demonstrated through play, revised, combined, or left unset. Separate affinity from rank.
- **Priority:** High
- **Output needed:** Identity lifecycle specification.
- **Work type:** Writing; data; canon decision
- **Needs user decision before proceeding:** Yes

### PID-04 — Tie achievements to meaningful behavior

- **Problem:** The archive values achievement but has no rule separating meaningful records from engagement farming or cosmetic accumulation.
- **Why it matters:** Empty badges would reproduce the shallow acquisition system EGGS is trying to avoid.
- **Affected concepts/files:** MDP Sparks/XP concepts; competitive circuit; future achievement gallery.
- **Recommended fix:** Require each achievement to identify skill, contribution, history, or rivalry meaning; prohibit purchase-only achievements from implying mastery.
- **Priority:** High
- **Output needed:** Achievement design standard and initial examples.
- **Work type:** Writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes for standard

### PID-05 — Define player contribution versus canon authorship

- **Problem:** “Players are co-authors” and “players are canon” lack consent, review, ownership, and scope rules.
- **Why it matters:** Community work can create rights, privacy, moderation, and continuity problems.
- **Affected concepts/files:** `EGGS MDP (1).pdf`; community contribution plans.
- **Recommended fix:** Define contribution statuses, submission consent, attribution, licensing, review, rejection, project scope, and removal handling. Avoid promising automatic canonization.
- **Priority:** Critical
- **Output needed:** Community contribution and canon policy.
- **Work type:** Legal/design guardrail; canon decision
- **Needs user decision before proceeding:** Yes; qualified legal review also required

---

## 10. Para Poker / Product Strategy Issues

### PPR-01 — Define Para Poker's non-gambling product premise

- **Problem:** Para Poker is framed as part of the desired reuse model, but its boundaries are not yet a settled product statement.
- **Why it matters:** Poker language can cause mechanics, marketing, or monetization to drift toward wagering assumptions.
- **Affected concepts/files:** Foundation specification; future Para Poker documents and prototypes.
- **Recommended fix:** Define Para Poker around reads, incomplete information, pressure, history, rivalry, and identity, with explicit exclusions for wagering, deposits, rake, and cash-equivalent chips.
- **Priority:** Critical
- **Output needed:** Approved Para Poker product premise and exclusions.
- **Work type:** Writing; canon decision; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### PPR-02 — Remove paid-only competitive legitimacy

- **Problem:** The competitive circuit requires K-XP from paid events for major qualification while claiming payment is optional.
- **Why it matters:** This is structurally pay-to-advance and conflicts with the project's player-first philosophy.
- **Affected concepts/files:** `INTRODUCTION to Competetive circuit (2).pdf`.
- **Recommended fix:** Retire or rewrite paid-only XP, tickets, weighting, placement legitimacy, and required paid pathways. If paid events remain, ensure equivalent competitive qualification paths.
- **Priority:** Critical
- **Output needed:** Revised qualification philosophy and circuit model.
- **Work type:** Product strategy writing; legal/design guardrail; canon decision
- **Needs user decision before proceeding:** Yes

### PPR-03 — Reconcile symbolic recognition with XP architecture

- **Problem:** The MDP rejects automated points and favors human recognition, while the circuit proposes multiple grindable XP currencies.
- **Why it matters:** Product direction is internally inconsistent and may produce engagement farming.
- **Affected concepts/files:** `EGGS MDP (1).pdf`; competitive circuit PDF.
- **Recommended fix:** Decide which stages use human recognition, earned records, ratings, contribution evidence, or XP. Define what XP must never represent.
- **Priority:** High
- **Output needed:** Recognition and progression architecture decision.
- **Work type:** Product strategy writing; canon decision
- **Needs user decision before proceeding:** Yes

### PPR-04 — Define competitive prestige without spending proxies

- **Problem:** The circuit explicitly treats K-XP as a proxy for money spent and uses paid perks to create prestige.
- **Why it matters:** This reduces identity and legitimacy to transaction history.
- **Affected concepts/files:** Competitive circuit pages 3–6.
- **Recommended fix:** Base prestige on verified skill, sportsmanship, contribution, seasonal performance, difficult accomplishments, and recorded rivalry history.
- **Priority:** Critical
- **Output needed:** Prestige model and prohibited monetization patterns.
- **Work type:** Product strategy writing; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### PPR-05 — Separate product strategy from creative canon

- **Problem:** MDP and circuit proposals are stored beside cosmology and lore without layer labels.
- **Why it matters:** Temporary operational ideas may be mistaken for evergreen creative commitments.
- **Affected concepts/files:** Both product PDFs; current index.
- **Recommended fix:** Reclassify them as dated business/product strategy artifacts, link relevant guardrails, and create successor documents rather than altering sources.
- **Priority:** High
- **Output needed:** Product artifact classifications and supersession links.
- **Work type:** Data; writing
- **Needs user decision before proceeding:** No for provisional classification

---

## 11. Legal / Monetization Risk Issues

### LGL-01 — Retract unsupported legal-safety claims

- **Problem:** The competitive circuit declares ticket/XP structures legally clean without qualified analysis.
- **Why it matters:** Labels and non-cash terminology do not by themselves determine legal treatment.
- **Affected concepts/files:** `INTRODUCTION to Competetive circuit (2).pdf`, especially ticket and prize-funding sections.
- **Recommended fix:** Mark legal claims risky, prohibit reuse as guidance, and require jurisdiction-specific counsel for paid entry, prizes, chance, wagering, or redeemable value.
- **Priority:** Critical
- **Output needed:** Legal-review warning record and red-flag summary for counsel.
- **Work type:** Legal/design guardrail
- **Needs user decision before proceeding:** No to flag; Yes plus qualified counsel before implementation

### LGL-02 — Create monetization guardrails

- **Problem:** The archive lacks approved boundaries for paid events, cosmetics, progression, scarcity, and competitive advantage.
- **Why it matters:** Product proposals can silently recreate extraction or pay-to-win dynamics.
- **Affected concepts/files:** MDP; competitive circuit; Para Poker; future games.
- **Recommended fix:** Define prohibited, review-required, and presumptively acceptable patterns, including paid-only qualification and leaderboard weighting.
- **Priority:** Critical
- **Output needed:** Monetization and competitive-integrity guardrail.
- **Work type:** Legal/design guardrail; canon decision
- **Needs user decision before proceeding:** Yes; counsel review where applicable

### LGL-03 — Define prize and tournament review triggers

- **Problem:** No standard triggers review when a design adds entry fees, prizes, tickets, or cash equivalents.
- **Why it matters:** Risk depends on mechanics, jurisdiction, participant age, prize funding, and marketing—not terminology alone.
- **Affected concepts/files:** Competitive circuit; all future tournament plans.
- **Recommended fix:** Create a mandatory intake checklist and blocking review flag for any payment/prize/chance/value combination.
- **Priority:** High
- **Output needed:** Tournament legal/design review checklist.
- **Work type:** Legal/design guardrail
- **Needs user decision before proceeding:** No for drafting; qualified counsel for final legal checklist

### LGL-04 — Define community content rights and consent

- **Problem:** Co-creation is encouraged without submission terms, licenses, privacy rules, or withdrawal handling.
- **Why it matters:** EGGS may not have clear rights to store, modify, publish, or commercialize contributed work.
- **Affected concepts/files:** MDP community loop; future submissions and profiles.
- **Recommended fix:** Develop plain-language contribution terms and internal review procedure with qualified counsel.
- **Priority:** Critical
- **Output needed:** Contribution rights requirements and counsel-ready questions.
- **Work type:** Legal/design guardrail
- **Needs user decision before proceeding:** Yes; qualified legal review required

### LGL-05 — Review cultural and symbolic harm controls

- **Problem:** The ethics codex is principled but absolute in places, while current materials contradict it and use recognizable architecture/symbols.
- **Why it matters:** An unworkable rulebook may be ignored; a vague one may not prevent harm.
- **Affected concepts/files:** Ethics codex; civilization prose; concept art.
- **Recommended fix:** Convert the ethics codex into operational checks with escalation triggers, examples, and documented exceptions rather than unsupported assurances.
- **Priority:** High
- **Output needed:** Revised cultural/fiction design guardrail and review worksheet.
- **Work type:** Legal/design guardrail; writing
- **Needs user decision before proceeding:** Yes

---

## 12. Visual Art Bible Issues

### ART-01 — Audit visual consistency by concept

- **Problem:** The art archive mixes watercolor, ink, generic fantasy rendering, steampunk, direct architecture, and varied AI aesthetics.
- **Why it matters:** Quantity can be mistaken for a coherent visual identity.
- **Affected concepts/files:** All folders under `Archive/Art`.
- **Recommended fix:** Review every asset for concept, style, motif value, distinctiveness, quality, provenance, and canon suitability.
- **Priority:** High
- **Output needed:** Visual audit table with keep/reference/rework/retire recommendations.
- **Work type:** Data; writing
- **Needs user decision before proceeding:** No for audit; Yes for final selection

### ART-02 — Separate motif evidence from canonical depiction

- **Problem:** A useful texture, composition, or material cue may cause an entire image to be treated as canon.
- **Why it matters:** Strong fragments should be reusable without importing weak or risky imagery wholesale.
- **Affected concepts/files:** All concept art; future motif records.
- **Recommended fix:** Extract approved motifs into separate records linked by `inspires`, while leaving source images at their true authority and rights status.
- **Priority:** High
- **Output needed:** Initial motif library with source links.
- **Work type:** Data; writing
- **Needs user decision before proceeding:** Yes for motif approval

### ART-03 — Create visual grammars for the three principles

- **Problem:** The alien principles have prose but no stable non-generic visual language.
- **Why it matters:** Without one, Zynarth becomes insects, Voltari becomes robots, and Zendra becomes purple psychic effects.
- **Affected concepts/files:** Alien principle prose; current and future art.
- **Recommended fix:** Define shapes, repetition, materials, motion, spatial behavior, contrast, sound relationships, and exclusions for each principle.
- **Priority:** High
- **Output needed:** Three visual grammar briefs.
- **Work type:** Writing; canon decision
- **Needs user decision before proceeding:** Yes

### ART-04 — Flag direct real-world architecture and symbols

- **Problem:** Some images use recognizable religious or cultural architecture, including the explicit “Steampunk Constantinople” reference.
- **Why it matters:** This conflicts with the current ethics direction and may create unintended cultural readings.
- **Affected concepts/files:** `Archive/Art/Bizi/Places/Steampunk_constantinople_in_sepiaa.webp`; other civilization place art.
- **Recommended fix:** Add cultural-reference review flags, restrict risky assets to internal reference, and commission or generate transformed replacements only after motif direction is approved.
- **Priority:** High
- **Output needed:** Flagged-asset list and replacement briefs.
- **Work type:** Data; legal/design guardrail
- **Needs user decision before proceeding:** No to flag; Yes for replacement direction

### ART-05 — Define art curation standards

- **Problem:** The MDP simultaneously encourages messy AI output and calls for tight curation, without criteria.
- **Why it matters:** “Curated” can become subjective gatekeeping or fail to protect consistency and rights.
- **Affected concepts/files:** `EGGS MDP (1).pdf`; all art submissions.
- **Recommended fix:** Define review criteria for originality, concept relevance, craft, style fit, rights, cultural risk, AI disclosure, and intended use.
- **Priority:** High
- **Output needed:** Art intake and curation rubric.
- **Work type:** Writing; data; legal/design guardrail
- **Needs user decision before proceeding:** Yes

---

## 13. App/Data Model Issues

### DAT-01 — Preserve the workbook as migration input, not final schema

- **Problem:** The index combines import data, stable metadata, formulas, and dashboard views in a structure that cannot represent the full archive model.
- **Why it matters:** Building directly on it would hard-code current ambiguity.
- **Affected concepts/files:** `Index/creative_asset_system_index.xlsx`; `Index/readme.txt`.
- **Recommended fix:** Freeze a migration snapshot, document sheet roles, and map workbook fields into the foundation schemas without changing source authority.
- **Priority:** Critical
- **Output needed:** Workbook-to-schema migration specification.
- **Work type:** Data; app
- **Needs user decision before proceeding:** No for specification; app work remains deferred

### DAT-02 — Replace filenames as record keys

- **Problem:** Generic names such as `image.png` collide, while renamed files can shift metadata associations.
- **Why it matters:** Identity and relationships cannot safely depend on filenames.
- **Affected concepts/files:** Index `Name` columns; many art assets.
- **Recommended fix:** Generate immutable artifact IDs and checksums; retain filenames as mutable metadata and aliases.
- **Priority:** Critical
- **Output needed:** ID strategy and duplicate-detection report.
- **Work type:** Data; app
- **Needs user decision before proceeding:** No for design; app execution deferred

### DAT-03 — Repair index name/path alignment

- **Problem:** Sampled workbook rows show stable metadata names shifted relative to imported filenames and paths.
- **Why it matters:** Incorrect joins can assign metadata to the wrong artwork.
- **Affected concepts/files:** `Files!AA:AK` and generated `assets` view in the workbook.
- **Recommended fix:** Validate each name against path basename and checksum, quarantine mismatches, and rebuild metadata joins by stable ID.
- **Priority:** Critical
- **Output needed:** Mismatch report and corrected migration table.
- **Work type:** Data
- **Needs user decision before proceeding:** No; ambiguous matches require user review

### DAT-04 — Replace absolute machine paths

- **Problem:** The workbook stores `C:\Users\...` paths tied to one machine.
- **Why it matters:** The archive will not migrate cleanly to another computer or app environment.
- **Affected concepts/files:** Workbook filepath fields.
- **Recommended fix:** Store workspace-relative paths, normalized separators, and optional resolved local paths at runtime.
- **Priority:** High
- **Output needed:** Path normalization rule and converted migration field.
- **Work type:** Data; app
- **Needs user decision before proceeding:** No

### DAT-05 — Normalize nulls and controlled values

- **Problem:** Empty Purpose/Tone/Status cells appear as zeros in the generated view, and tag completion is sparse.
- **Why it matters:** Zero values look meaningful and damage filtering and validation.
- **Affected concepts/files:** Workbook `assets` sheet and formulas.
- **Recommended fix:** Convert empty values to null, validate enums, and preserve unknown as unknown rather than inventing defaults.
- **Priority:** High
- **Output needed:** Data-cleaning rules and validation report.
- **Work type:** Data
- **Needs user decision before proceeding:** No

### DAT-06 — Model entities separately from artifacts

- **Problem:** Current folders and rows make an artwork, faction, character, concept, and place look like variations of one record type.
- **Why it matters:** One concept can have many artifacts, and one artifact can depict many entities.
- **Affected concepts/files:** Entire index and archive filesystem.
- **Recommended fix:** Use separate entity, artifact, relationship, and project-usage records with many-to-many links.
- **Priority:** Critical
- **Output needed:** Approved logical data model and example migration records.
- **Work type:** Data; app; canon decision
- **Needs user decision before proceeding:** Yes for final model; no app build yet

### DAT-07 — Define typed relationship governance

- **Problem:** Relationships are currently implied in prose or folder placement.
- **Why it matters:** Reuse, contradiction, derivation, and supersession cannot be queried reliably.
- **Affected concepts/files:** All concepts and artifacts; future app.
- **Recommended fix:** Adopt the relationship types in the foundation specification, define directionality and constraints, and require evidence for interpretive links.
- **Priority:** High
- **Output needed:** Relationship dictionary and validation rules.
- **Work type:** Data; app
- **Needs user decision before proceeding:** Yes for adoption

### DAT-08 — Define first-build acceptance tests without building

- **Problem:** The future app can easily expand into graph visualization, generation, profiles, or marketplace features before basic archive work is proven.
- **Why it matters:** Overengineering would delay useful browsing and classification.
- **Affected concepts/files:** `ARCHIVE_FOUNDATION_SPEC.md`; future app plan.
- **Recommended fix:** Convert the first-build scope into testable stories for import, browsing, status visibility, search, relationships, project usage, and decisions. Keep deferred features explicit.
- **Priority:** Medium
- **Output needed:** App acceptance-test backlog, with all implementation tasks marked deferred.
- **Work type:** App; writing
- **Needs user decision before proceeding:** Yes before app work begins

---

## 14. Provenance / Rights / Source Tracking Issues

### PRV-01 — Inventory creator and source provenance

- **Problem:** Many images have generic or generated filenames, and creator/source information is absent.
- **Why it matters:** Unknown origin blocks confident publication, modification, attribution, and commercial use.
- **Affected concepts/files:** All files under `Archive/Art`; Discord `.url` reference; deployable card images.
- **Recommended fix:** Capture creator, source URL, acquisition date, original filename, and known usage terms. Mark unknowns explicitly.
- **Priority:** Critical
- **Output needed:** Provenance inventory with unknown-source queue.
- **Work type:** Data; legal/design guardrail
- **Needs user decision before proceeding:** No to inventory; Yes before risky commercial use

### PRV-02 — Track AI generation details

- **Problem:** AI-generated assets appear in the archive without consistent model, prompt, date, editing, or contributor records.
- **Why it matters:** Rights, platform rules, reproducibility, curation, and public disclosure may depend on provenance.
- **Affected concepts/files:** DALL-E and ChatGPT-named files; other suspected AI images.
- **Recommended fix:** Add `ai_generated`, model, prompt, generation date, human edits, contributor, and confidence fields. Use unknown when evidence is missing.
- **Priority:** High
- **Output needed:** AI provenance report and metadata standard.
- **Work type:** Data; legal/design guardrail
- **Needs user decision before proceeding:** No

### PRV-03 — Assign rights status and use restrictions

- **Problem:** The archive lacks controlled rights statuses.
- **Why it matters:** Reference-only material may accidentally ship in games or marketing.
- **Affected concepts/files:** All art, community contributions, external references, and deployables.
- **Recommended fix:** Use statuses such as owned, licensed, permission-recorded, public-domain-verified, internal-reference-only, and unknown-needs-review. Default unknown to internal reference only.
- **Priority:** Critical
- **Output needed:** Rights-status taxonomy and artifact assignments.
- **Work type:** Data; legal/design guardrail
- **Needs user decision before proceeding:** Yes for policy; counsel for uncertain cases

### PRV-04 — Detect duplicates and derivative chains

- **Problem:** Similar images, format variants, renamed files, and source derivatives are not linked.
- **Why it matters:** Duplicates inflate archive size and obscure which version is approved or properly sourced.
- **Affected concepts/files:** Art folders, especially repeated numbered images and `.url` references.
- **Recommended fix:** Calculate checksums and perceptual similarity later during migration; meanwhile document obvious variants and designate parent/derivative relationships.
- **Priority:** Medium
- **Output needed:** Duplicate/variant report and derivative relationship rules.
- **Work type:** Data; app
- **Needs user decision before proceeding:** No; destructive deduplication is not authorized

### PRV-05 — Create source citation requirements for concepts

- **Problem:** Canon and design records may summarize ideas without traceability to source artifacts or decisions.
- **Why it matters:** Future sessions need to distinguish interpretation from documented origin.
- **Affected concepts/files:** All future structured records and rewrites.
- **Recommended fix:** Require source artifact IDs and decision IDs for canon claims, with optional passage/page locators.
- **Priority:** High
- **Output needed:** Concept-source citation standard.
- **Work type:** Data; writing
- **Needs user decision before proceeding:** No for draft; Yes for adoption

---

## 15. Decision Log Items

These items are decisions to record, not substitutes for the remediation tasks above.

### DEC-01 — Canonical spelling for Zynarth

- **Problem:** Zynarth and Xynarth coexist.
- **Why it matters:** Entity identity and search require one canonical display name.
- **Affected concepts/files:** `what are xynarth.txt`; all hybrid and foundation references.
- **Recommended fix:** Approve `Zynarth` as canonical and retain `Xynarth` as a source alias, unless the user chooses otherwise.
- **Priority:** Critical
- **Output needed:** Rename decision record.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-02 — Meaning of Xen’Dra relative to Zendra

- **Problem:** Xen’Dra may be a species, manifestation, title, or spelling variant.
- **Why it matters:** The poem cannot be indexed correctly without the distinction.
- **Affected concepts/files:** `zendrapoem.txt`; `what are zendra.txt`.
- **Recommended fix:** Choose one relation and document `should_not_be_confused_with` or alias behavior.
- **Priority:** High
- **Output needed:** Definition decision record.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-03 — Convergence versus Morphling terminology

- **Problem:** Abstract and embodied hybrids share one label.
- **Why it matters:** This blocks clean writing and schemas.
- **Affected concepts/files:** `what are morphlings.txt`; foundation specification.
- **Recommended fix:** Approve Convergence for abstract combinations and Morphling for embodiments.
- **Priority:** Critical
- **Output needed:** Terminology decision record.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-04 — Ecosystem hierarchy

- **Problem:** Brand, world, game, and community names overlap.
- **Why it matters:** Project canon and app navigation depend on scope.
- **Affected concepts/files:** MDP; ethics codex; index readme.
- **Recommended fix:** Approve the hierarchy produced by FND-01.
- **Priority:** Critical
- **Output needed:** Scope/hierarchy decision record.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-05 — Principle grammar limits

- **Problem:** It is unclear whether the three principles are exhaustive metaphysics or optional design lenses.
- **Why it matters:** This controls creative freedom across every future project.
- **Affected concepts/files:** `alien principle.txt`; foundation specification.
- **Recommended fix:** Approve a lens-based, non-totalizing interpretation unless exhaustive metaphysics is explicitly desired.
- **Priority:** High
- **Output needed:** Foundation interpretation decision.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-06 — Status of Rumin, Frumo, Bizi, and Sheen

- **Problem:** Their kernels are strong but their histories require substantial transformation.
- **Why it matters:** Teams need to know whether to rewrite, freeze, merge, or retire them.
- **Affected concepts/files:** Four civilization files, four timelines, and associated art.
- **Recommended fix:** Decide per civilization: active rewrite, flexible inspiration, experimental hold, merge, or retire.
- **Priority:** High
- **Output needed:** Four scoped status decisions.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-07 — Status of Jali, Mekan, Gracus, and Indela

- **Problem:** These concepts are present but undefined or unevenly documented.
- **Why it matters:** Their material cannot be curated or reused responsibly without status.
- **Affected concepts/files:** Corresponding art folders; Indela prose mention.
- **Recommended fix:** Decide active, experimental, merge candidate, or retired after CIV-06 dossier.
- **Priority:** Medium
- **Output needed:** Classification decisions.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

### DEC-08 — Player affinity model

- **Problem:** Single-faction selection conflicts with layered identity.
- **Why it matters:** This shapes onboarding, profiles, achievements, and community language.
- **Affected concepts/files:** MDP; future player systems.
- **Recommended fix:** Approve layered, revisable affinities or explicitly choose a different model.
- **Priority:** High
- **Output needed:** Player identity model decision.
- **Work type:** Canon decision; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### DEC-09 — Para Poker product boundaries

- **Problem:** Poker-inspired competition needs clear separation from gambling and pay-to-win design.
- **Why it matters:** Mechanics, marketing, progression, and legal review depend on the boundary.
- **Affected concepts/files:** Foundation specification; future Para Poker work.
- **Recommended fix:** Approve the non-gambling premise and prohibited mechanics from PPR-01.
- **Priority:** Critical
- **Output needed:** Product guardrail decision.
- **Work type:** Canon decision; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### DEC-10 — Competitive circuit disposition

- **Problem:** The current circuit contains paid-only advancement and unsupported legal claims.
- **Why it matters:** It cannot safely guide implementation in its present form.
- **Affected concepts/files:** `INTRODUCTION to Competetive circuit (2).pdf`.
- **Recommended fix:** Choose retire-and-replace, major rewrite, or research-only archive status.
- **Priority:** Critical
- **Output needed:** Product artifact disposition decision.
- **Work type:** Canon decision; legal/design guardrail
- **Needs user decision before proceeding:** Yes

### DEC-11 — Art rights default

- **Problem:** Unknown-source art lacks a default usage rule.
- **Why it matters:** Without one, risky material may ship accidentally.
- **Affected concepts/files:** Entire art archive.
- **Recommended fix:** Approve `unknown = internal reference only` until rights are verified.
- **Priority:** Critical
- **Output needed:** Rights policy decision.
- **Work type:** Legal/design guardrail; canon decision
- **Needs user decision before proceeding:** Yes

### DEC-12 — Foundation specification approval

- **Problem:** `ARCHIVE_FOUNDATION_SPEC.md` is currently strong direction, not approved foundation canon.
- **Why it matters:** The archive needs an authoritative operating manual before large-scale remediation or app work.
- **Affected concepts/files:** `ARCHIVE_FOUNDATION_SPEC.md`; `AGENTS.md`; this backlog.
- **Recommended fix:** Review, amend, and approve selected sections; log any exclusions or provisional clauses.
- **Priority:** Critical
- **Output needed:** Approval decision with section-level exceptions if needed.
- **Work type:** Canon decision
- **Needs user decision before proceeding:** Yes

---

## Completion definition

The archive is remediation-ready for app implementation when:

- Core vocabulary and ecosystem hierarchy are approved.
- Every artifact has a provisional layer, authority status, review state, and source path.
- Principle and convergence definitions are approved and mechanically actionable.
- Current civilizations have explicit rewrite/hold/retire decisions.
- Historical transcription contradictions have been resolved.
- Player identity and Para Poker guardrails are approved.
- Paid-only competitive legitimacy and unsupported legal claims are retired or replaced.
- Art provenance, rights defaults, and visual curation standards exist.
- The workbook migration specification, stable-ID plan, and relationship dictionary are complete.
- Significant decisions are recorded rather than inferred.

Meeting these conditions authorizes planning the app build; it does not automatically authorize implementation.
