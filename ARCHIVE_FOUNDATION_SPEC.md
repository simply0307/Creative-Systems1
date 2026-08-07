# EGGS / Para Archive Foundation Specification

Version: 0.1
Status: Strong direction; requires user approval before becoming foundation canon
Purpose: Operating manual for storing, interpreting, indexing, reviewing, and reusing the EGGS / Para creative archive.

## 1. Foundation statement

The EGGS / Para archive is the evergreen creative systems library for EGGS games. It is not one game's lore bible, a generic fantasy wiki, a collection of finished canon, or a requirement that every project reproduce the same factions literally.

The archive preserves reusable symbolic pressures, thematic questions, mechanical patterns, aesthetic motifs, player identities, competitive meanings, and project-specific expressions. Future EGGS games should derive meaningful inspiration from it, but may express that inheritance through lore, mechanics, achievements, cards, player profiles, interfaces, competitive structures, visual language, or hidden design logic.

The archive's foundational creative proposition is:

> Alien principles define pressures on what can happen. Mortal expressions show how those pressures feel when embodied in a particular world, culture, institution, game, or player experience.

Future games must use the archive intentionally, not ceremonially. A project satisfies archive reuse when it documents at least one material derivation from a principle, convergence, motif, archetype, guardrail, or prior expression. Merely copying a faction name, color, or emblem does not count.

The archive should help EGGS games create identity, history, achievement, rivalry, and meaning without reducing players to deposits, wagering, rake, pay-to-win progression, or empty cosmetic acquisition.

### Operating rules

- Preserve source material even when it is rejected, but label it accurately.
- Never infer canon from file presence, folder placement, age, polish, or quantity.
- Treat current lore as evidence and design material, not automatic truth.
- Separate universal principles from world-specific expressions.
- Prefer layered affinities over compulsory single-faction identity.
- Give every player-facing force a constructive aspiration as well as a failure mode.
- Record significant canon, naming, merge, retirement, and guardrail decisions.
- Let projects omit principles that do not improve the game.
- Transform historical inspiration; do not transcribe recognizable timelines with renamed surfaces.

### Current index disposition

The workbook at `Index/creative_asset_system_index.xlsx` should remain as the current inventory and ingestion scaffold until the app can import and validate it. It should not become the final domain model.

Keep from the workbook:

- A master artifact inventory.
- Browsable views over master data.
- Controlled labels for purpose, tone, and status.
- Faction/entity and subject/category filtering.
- Direct links to source files.

Change for the app:

- Replace filename keys with stable IDs.
- Store workspace-relative paths instead of machine-specific absolute paths.
- Separate linked entities from free-text faction labels.
- Separate canon authority from review state.
- Add provenance, creator, rights, AI-generation, source URL, checksum, version, and duplicate fields.
- Treat `assets` as a generated view, not a second source of truth.
- Replace zero-filled empty metadata with true null values.
- Validate name/path alignment during import.

The app should retain an `import_source` and `legacy_row_id` so every migrated record can be traced back to the workbook.

## 2. Core vocabulary

### Principle

A durable abstract pressure or design law that can be expressed across worlds and games. A principle is not automatically a species, government, morality, or player team.

### Faction

A broad product-facing grouping used only when a more precise term would be awkward. In structured data, use the specific subtype: alien principle, mortal civilization, organization, player affiliation, or project faction. `Faction` must not erase differences between these categories.

### Alien Principle

A foundational symbolic engine that shapes occurrences and design meanings. The current core alien principles are Zynarth, Voltari, and Zendra. They may appear as beings or civilizations in a project, but their foundational role is abstract.

### Mortal Civilization

A culturally and historically specific expression of one or more principles. It has institutions, bodies, myths, contradictions, and local history. It is not universal and does not automatically carry across projects.

### Expression

Any concrete manifestation of a more abstract concept. A civilization, mechanic, achievement, character, institution, event, or interface pattern may express a principle or convergence.

### Convergence

The abstract interaction between two or more principles. A convergence defines combined pressures such as organized appetite or contagious belief. It is design logic, not necessarily a creature type.

### Morphling

An embodied hybrid identity, being, group, or form produced by a convergence. Morphlings are specific hybrid expressions, not generic shapeshifters. Every Morphling must identify the principles or convergence it embodies.

### Astral Vanguard

An outsider, entrant, explorer, observer, archivist, intervener, or player-facing traveler who can recognize patterns across worlds. Astral Vanguards are not a fourth alien principle and not a default moral authority. Their central tension is whether understanding grants responsibility, temptation, or illegitimate control.

### Archetype

A reusable player, strategy, behavior, or identity pattern. Archetypes translate concepts into player-facing aspirations without requiring literal lore allegiance.

### Motif

A reusable sensory or symbolic unit: shape, material, rhythm, color relationship, sound, phrase, motion, architecture rule, icon pattern, or recurring image. A motif is not canon merely because it appears frequently in concept art.

### Project Usage

A documented instance of a project using an archive concept. It records what was used, where it appears, how literally it appears, and what was changed.

### Canon Status

The approved authority level of a concept within the ecosystem or a specific project. Canon status is distinct from review flags such as risky or contradictory.

### Artifact

A source file or external reference stored or indexed by the archive, including prose, art, PDFs, spreadsheets, cards, prompts, audio, video, and links. Artifacts contain or support concepts; they are not automatically concepts or canon.

### Decision Log

An append-only record explaining a consequential approval, rejection, rename, merge, split, contradiction resolution, guardrail, or retirement. It preserves reasoning and supersession history.

## 3. Layer model

### Foundational canon

Contains ecosystem-wide purpose, definitions, approved principles, interpretive rules, and durable ethical commitments.

Does not contain individual timelines, temporary product plans, unapproved names, or every sentence from a foundation document.

### Alien principles

Contains the definitions, verbs, constructive forms, failure modes, questions, mechanical affordances, and distinctions of Zynarth, Voltari, and Zendra.

Does not assume that every game must portray aliens literally or that every occurrence must be explained by all three.

### Convergences / hybrids

Contains pairwise and multi-principle interactions, their combined logic, and approved Morphling derivations.

Does not use “hybrid” as permission for arbitrary mixtures or generic shapeshifting.

### Mortal expressions

Contains civilizations, cultures, institutions, characters, events, and worlds that embody principles locally.

Does not promote recognizable historical retellings to universal canon or confuse a civilization with the principle it expresses.

### Project-specific lore

Contains facts approved for one game or product: settings, plots, characters, maps, timelines, and local terminology.

Does not silently bind other projects or overwrite foundation definitions.

### Player-facing identity

Contains affinities, archetypes, profiles, titles, achievement families, reputations, rivalries, and career records.

Does not accuse players of embodying a principle's worst political or psychological form. It should emphasize aspirations, style, history, and chosen meaning.

### Game mechanics translation

Contains reusable mechanic tags, resource patterns, victory behaviors, information structures, rule modules, and tested implementations derived from archive concepts.

Does not claim thematic alignment merely because names or colors were applied to unrelated mechanics.

### Visual / aesthetic motifs

Contains reviewed motifs, visual grammars, material languages, motion patterns, palettes, sound cues, and approved references.

Does not treat uncurated concept art, direct real-world symbols, AI output, or inconsistent style experiments as an art bible.

### Business / product strategy

Contains onboarding, community cadence, tournament operations, monetization proposals, release plans, and market hypotheses.

Does not define fiction canon. Business claims involving payments, prizes, progression, or legal safety require separate review.

### Legal / design guardrails

Contains approved restrictions and required review triggers concerning player treatment, gambling, pay-to-win design, historical trauma, cultural symbols, community contributions, privacy, intellectual property, AI provenance, and accessibility.

Does not make unsupported declarations of legality. Guardrails identify requirements and escalation points; qualified counsel determines legal compliance.

### Retired or experimental material

Contains preserved concepts that are rejected, superseded, contradictory, exploratory, or not ready for use.

Does not disappear from search or regain current authority through reuse without a new decision log entry.

## 4. Canon status system

Store authority and review separately. The app displays both as badges.

### Authority status

| Status | Meaning | Default app treatment |
|---|---|---|
| Foundation canon | Approved across the EGGS gaming ecosystem | Dark, prominent badge; protected edit flow |
| Project canon | Approved only within named project scopes | Project-colored badge with project links |
| Strong direction | Preferred direction awaiting final approval or further proof | High-visibility amber badge |
| Flexible inspiration | Reusable material with no binding authority | Neutral badge; available in discovery |
| Experimental | Active test or speculative concept | Dotted or lab-style badge |
| Retired | Preserved but not current | Muted badge; excluded from default reuse suggestions |

### Review flags

| Flag | Meaning | Required behavior |
|---|---|---|
| Contradictory | Conflicts with another record or approved rule | Show conflict links; block silent promotion |
| Risky / needs review | May create legal, ethical, rights, cultural, gambling, or design risk | Show warning; require named review before shipping |
| Needs user decision | Material choice cannot be settled from existing records | Put in decision queue; do not infer approval |

An item may be `strong_direction` and also `risky`. A retired item may remain `contradictory` to explain why it was retired.

### Promotion rules

- Foundation canon requires an explicit decision log entry and user approval.
- Project canon requires a project scope and approver.
- Strong direction may be used in prototypes but must be labeled.
- Flexible inspiration may be transformed freely within guardrails.
- Experimental material cannot be presented publicly as settled canon.
- Retired material may inspire new work only through a new derivative record; do not reactivate it silently.
- Risk and contradiction flags cannot be removed without a decision log entry.

## 5. Reuse model

Every reusable concept should be evaluated against the following channels. Each evaluation uses `not_applicable`, `possible`, `strong`, `tested`, or `approved`, with a short rationale and linked examples.

| Channel | Evaluation question |
|---|---|
| Lore | Can it create conflicts, institutions, characters, places, or history without requiring direct repetition? |
| Mechanics | Does it imply verbs, resources, information rules, tempo, risk, or victory behavior? |
| Player identity | Is there an aspirational identity a player can choose without being insulted or diagnosed? |
| Achievements | Can it classify meaningful accomplishments rather than routine consumption? |
| Cards / badges | Can it produce readable collectible units with provenance and earned significance? |
| UI / HUD | Can hierarchy, pressure, signal, memory, or convergence appear through interaction and information design? |
| Profiles | Can it enrich career history, affinities, titles, rivalries, and records? |
| Competitive ladders | Can it shape ranking meaning, season structure, team behavior, or style recognition without pay-to-win? |
| Marketing / community | Can it provide rituals, language, events, or prompts without flattening the concept into a mascot? |
| Para Poker | Can it create poker-inspired reads, pressure, structure, identity, and history without deposits, rake, wagering, cash-equivalent chips, or paid advantage? |
| Future EGGS games | Can the concept survive genre, platform, tone, and setting changes? |

### Required reuse record

Each project usage should state:

- Source concept.
- Project and feature.
- Usage channel.
- Literalness: `explicit_lore`, `visible_system`, `aesthetic`, `symbolic`, or `hidden_logic`.
- Transformation made.
- Player-facing promise.
- Failure mode or guardrail checked.
- Evidence: design document, build, screenshot, playtest, or shipped reference.

## 6. Data model

### Conventions and common fields

IDs are immutable lowercase namespaced strings such as `principle.zynarth` or UUIDs with a readable slug. Relationships use IDs, never display names.

All concept entities share:

| Field | Type | Example |
|---|---|---|
| id | string | `principle.zynarth` |
| name | string | `Zynarth` |
| slug | string | `zynarth` |
| summary | string | `Quantity becomes destiny.` |
| authority_status | enum | `foundation_canon` |
| review_flags | enum[] | `["needs_user_decision"]` |
| tags | string[] | `["pressure", "swarm"]` |
| source_artifact_ids | string[] | `["artifact.what-are-zynarth"]` |
| version | integer | `1` |
| created_at / updated_at | datetime | `2026-06-18T14:00:00-04:00` |

### Principle

| Field | Type | Example |
|---|---|---|
| kind | enum | `alien_principle` |
| core_question | string | `What happens when more becomes unstoppable?` |
| verbs | string[] | `["multiply", "consume", "compound", "adapt"]` |
| virtues | string[] | `["resilience", "solidarity"]` |
| failure_modes | string[] | `["runaway appetite", "snowballing"]` |
| mechanic_tags | string[] | `["swarm", "tempo", "replication"]` |
| exclusions | string[] | `["not merely insects", "not inherently evil"]` |
| visual_motif_ids | string[] | `["motif.repetition-pressure"]` |

### Faction

Use only as an umbrella record when a product needs a faction browser.

| Field | Type | Example |
|---|---|---|
| faction_type | enum | `player_affiliation` |
| member_entity_ids | string[] | `["civilization.rumin"]` |
| project_scope_ids | string[] | `["project.para-alpha"]` |
| identity_promise | string | `Mastery through coordinated structure.` |
| join_mode | enum | `affinity_not_exclusive` |
| should_not_be_confused_with_ids | string[] | `["principle.voltari"]` |

### Convergence

| Field | Type | Example |
|---|---|---|
| component_principle_ids | string[] | `["principle.zynarth", "principle.voltari"]` |
| synthesis | string | `Organized appetite.` |
| combined_verbs | string[] | `["scale", "route", "standardize", "consume"]` |
| constructive_forms | string[] | `["coordinated mutual aid"]` |
| destructive_forms | string[] | `["procedural extraction"]` |
| mechanic_tags | string[] | `["engine-building", "production-chain"]` |
| morphling_ids | string[] | `["morphling.example-organized-swarm"]` |

### Morphling

| Field | Type | Example |
|---|---|---|
| convergence_id | string | `convergence.zynarth-voltari` |
| embodiment_type | enum | `character` |
| body_or_form | string | `A colony that arranges itself into administrative castes.` |
| stable_traits | string[] | `["collective", "procedural"]` |
| variable_traits | string[] | `["scale", "material", "allegiance"]` |
| narrative_role | string | `Border identity that neither source can fully claim.` |
| generic_shapeshifter | boolean | `false` |
| project_scope_ids | string[] | `["project.example"]` |

### Mortal Civilization

| Field | Type | Example |
|---|---|---|
| principle_affinities | object[] | `[{"id":"principle.voltari","weight":0.6},{"id":"principle.zynarth","weight":0.4}]` |
| central_contradiction | string | `Order protects life until it begins owning it.` |
| signature_verbs | string[] | `["tax", "map", "contract", "expand"]` |
| institutions | string[] | `["banks", "courts", "legions"]` |
| cultural_forms | string[] | `["civic spectacle", "debt ritual"]` |
| historical_inspiration | string[] | `["imperial finance"]` |
| transformation_distance | enum | `needs_rewrite` |
| project_scope_ids | string[] | `["project.reath"]` |

### Achievement

| Field | Type | Example |
|---|---|---|
| achievement_family | string | `Pressure Mastery` |
| criteria | object | `{"event":"win_after_trailing","count":3}` |
| principle_ids | string[] | `["principle.zynarth"]` |
| meaning | string | `Persistence turned a losing position into collective momentum.` |
| reward_type | enum | `title` |
| reward_value | string | `The Returning Tide` |
| repeatability | enum | `seasonal` |
| purchase_required | boolean | `false` |

### Player Archetype

| Field | Type | Example |
|---|---|---|
| player_promise | string | `You read unstable situations before others do.` |
| principle_affinities | object[] | `[{"id":"principle.zendra","weight":0.8}]` |
| positive_traits | string[] | `["perceptive", "adaptive", "imaginative"]` |
| shadow_traits | string[] | `["overinterpretation", "misdirection"]` |
| observable_behaviors | string[] | `["bluffs selectively", "changes plans from new information"]` |
| suitable_channels | enum[] | `["profile", "achievement", "match_analysis"]` |
| accusatory_language | string[] | `["delusional", "cultist"]` |

### Motif

| Field | Type | Example |
|---|---|---|
| motif_type | enum | `motion` |
| sensory_description | string | `Many small marks accelerating into one mass.` |
| principle_ids | string[] | `["principle.zynarth"]` |
| allowed_uses | string[] | `["loading animation", "achievement frame"]` |
| prohibited_uses | string[] | `["direct insect emblem as default"]` |
| palette | string[] | `["#D6FF4B", "#171A12"]` |
| provenance_artifact_ids | string[] | `["artifact.reference-001"]` |
| rights_status | enum | `internal_reference_only` |

### Mechanic

| Field | Type | Example |
|---|---|---|
| verbs | string[] | `["replicate", "escalate"]` |
| input_resources | string[] | `["units", "turns"]` |
| output_effects | string[] | `["board pressure"]` |
| information_model | enum | `public` |
| principle_ids | string[] | `["principle.zynarth"]` |
| player_skill_test | string | `Know when growth becomes overextension.` |
| anti_pattern | string | `Unanswerable early snowball.` |
| implementation_status | enum | `prototype` |
| playtest_artifact_ids | string[] | `["artifact.playtest-042"]` |

### Project

| Field | Type | Example |
|---|---|---|
| project_type | enum | `game` |
| lifecycle_status | enum | `prototype` |
| premise | string | `Competitive poker-inspired reads without real-money wagering.` |
| audience | string[] | `["competitive social players"]` |
| used_concept_ids | string[] | `["principle.zendra", "principle.voltari"]` |
| excluded_concept_ids | string[] | `["civilization.rumin"]` |
| project_canon_ids | string[] | `["lore.para-poker-table"]` |
| guardrail_ids | string[] | `["guardrail.no-gambling-framing"]` |
| usage_records | object[] | `[{"concept_id":"principle.zendra","mode":"hidden_logic"}]` |

### Artifact

| Field | Type | Example |
|---|---|---|
| artifact_type | enum | `image` |
| relative_path | string | `Archive/Art/Rumin/Characters/AR-RUM-CHR-001.png` |
| original_filename | string | `AR-RUM-CHR-001.png` |
| checksum | string | `sha256:...` |
| creator | string or null | `null` |
| source_url | string or null | `null` |
| created_date | date or null | `2026-04-03` |
| ai_generated | boolean or null | `true` |
| model_and_prompt | object or null | `{"model":"unknown","prompt":null}` |
| rights_status | enum | `unknown_needs_review` |
| indexed_entity_ids | string[] | `["civilization.rumin"]` |
| legacy_index | object | `{"sheet":"Files","row":42}` |

### Decision Log

| Field | Type | Example |
|---|---|---|
| decision_type | enum | `rename` |
| subject_ids | string[] | `["principle.zynarth"]` |
| decision | string | `Use Zynarth as the canonical spelling.` |
| rationale | string | `Resolves Xynarth/Zynarth drift and follows current direction.` |
| alternatives | string[] | `["Xynarth"]` |
| decided_by | string | `archive owner` |
| decided_at | datetime | `2026-06-18T16:00:00-04:00` |
| supersedes_decision_id | string or null | `null` |
| affected_record_ids | string[] | `["artifact.what-are-xynarth"]` |

### Guardrail

| Field | Type | Example |
|---|---|---|
| category | enum | `monetization` |
| rule | string | `Para Poker must not require deposits, wagering, rake, or paid competitive advantage.` |
| rationale | string | `Preserve player-first competitive meaning and avoid gambling framing.` |
| severity | enum | `blocking` |
| applies_to | string[] | `["project_type:game", "tag:poker"]` |
| review_trigger | string | `Any cash-equivalent stake, prize, ticket, or paid qualification proposal.` |
| reviewer_type | enum | `user_and_qualified_counsel` |
| allowed_exceptions | string[] | `[]` |
| source_decision_id | string | `decision.para-poker-no-gambling` |

## 7. Relationship model

Relationships are directional records with `source_id`, `type`, `target_id`, optional `project_scope_id`, `strength`, `notes`, and `source_artifact_ids`.

| Type | Meaning | Example |
|---|---|---|
| hybrid_of | Embodied or abstract combination of sources | Morphling `hybrid_of` Zynarth and Voltari |
| expresses | Concrete entity manifests an abstract concept | Rumin `expresses` Zynarth–Voltari convergence |
| derives_from | Deliberate transformation or inheritance | Achievement `derives_from` Zynarth |
| critiques | Examines a system or failure mode | Rumin `critiques` procedural extraction |
| conflicts_with | Cannot coexist cleanly or contains contradiction | Timeline `conflicts_with` historical-transformation guardrail |
| supports | Reinforces or provides evidence for | Playtest `supports` mechanic pattern |
| replaces | Supersedes a prior entity or term | Convergence terminology `replaces` abstract use of Morphling |
| used_by | Concept is intentionally used by project | Zendra `used_by` Para Poker |
| appears_in | Entity is depicted or named in artifact/project | Character `appears_in` image |
| inspires | Loose, non-canonical influence | Concept art `inspires` motif |
| should_not_be_confused_with | Explicit semantic boundary | Astral Vanguard `should_not_be_confused_with` alien principle |

Additional allowed relationships should include `member_of`, `variant_of`, `supersedes`, `references`, `governed_by`, `prohibited_by`, and `tested_by`. New relationship types require a definition before use.

## 8. App interface model

### Archive home

Show archive purpose, concept counts by authority status, unresolved decisions, risk warnings, recently changed records, and project reuse coverage. Avoid a lore-news homepage.

### Foundations

Show the foundation statement, vocabulary, layer model, approved guardrails, and foundation decision history. Foundation edits should require a decision note.

### Alien Principles

Provide comparable pages for Zynarth, Voltari, and Zendra: core question, verbs, virtues, failure modes, mechanics, motifs, expressions, distinctions, and project use.

### Convergences

Use a matrix of principle combinations. Each page should distinguish abstract convergence logic from embodied Morphlings.

### Factions / Civilizations

Default to precise subtype filters. Show principle affinities, cultural contradiction, signature verbs, project scope, historical-distance review, and related artifacts.

### Para Application View

Show how archive concepts are used in current Para features: explicit lore, visible system, aesthetic layer, symbolic layer, or hidden logic. Include Para Poker guardrails prominently.

### Project Reuse Map

Map projects against principles, convergences, motifs, archetypes, mechanics, and guardrails. Show intentional omissions as well as uses.

### Achievement / Card Gallery

Browse achievements, cards, badges, and profile rewards by principle, archetype, earned meaning, project, season, and status. Do not organize primarily by purchase rarity.

### Decision Log

Provide append-only chronological and subject views, supersession chains, unresolved user decisions, and reasons for retirement or promotion.

### Retired Ideas

Keep retired material searchable with clear reasons, replacement links, and reuse restrictions. Exclude it from default current-canon views.

### Search and Filter

Search names, summaries, artifact text, tags, verbs, relationships, and decisions. Filter by layer, entity type, authority, review flag, project, principle, relationship, rights status, AI provenance, reuse channel, and updated date.

## 9. First build scope

The smallest useful app is a read-heavy local archive browser with controlled editing. It should solve classification and retrieval before automating content generation.

### Include

1. Import the current workbook and filesystem inventory into an artifact table.
2. Preserve legacy row/path traceability and report import mismatches.
3. Seed the three alien principle records, three pairwise convergences, Morphling definition, Astral Vanguard definition, four current mortal civilization records, and initial guardrails.
4. Provide entity detail pages with authority and review badges.
5. Provide relationship editing and backlinks.
6. Provide artifact linking, previews where practical, provenance, and rights fields.
7. Provide search and filters.
8. Provide project usage records and a simple reuse matrix.
9. Provide an append-only decision log.
10. Provide queues for needs-decision, contradiction, rights review, and risky material.

### Defer

- Public accounts and permissions beyond a simple local owner role.
- Automated lore generation.
- Player profile services.
- Live game telemetry.
- Complex graph visualization.
- Recommendation engines or embeddings.
- Automated canon promotion.
- Marketplace, token, payment, prize, or wagering systems.
- Full digital asset management or destructive file moves.

### First-build acceptance criteria

- A user can find every indexed artifact and see its provenance status.
- A user can distinguish foundation canon, project canon, inspiration, experiments, and retired material at a glance.
- A user can see how a concept is reused by projects.
- A user can find contradictions and pending decisions.
- No record becomes canon because it was imported.
- No app edit destroys or silently relocates a source artifact.

## 10. Risks and controls

### Explaining everything through three principles

Risk: The grammar becomes unfalsifiable and every design receives a superficial three-color interpretation.

Control: Allow `not_applicable`, intentional absence, and non-principle influences. Require a specific verb, mechanic, player promise, or thematic tension for claimed derivations.

### Accusatory player identity

Risk: Choosing Voltari implies authoritarianism, Zynarth implies greed, or Zendra implies delusion.

Control: Lead with constructive aspirations and observable play styles. Keep shadow traits as tensions, not diagnoses. Support mixed affinities and player-authored meaning.

### Generic fantasy

Risk: Principles collapse into bug swarm, robot empire, psychic cult, and generic shapeshifters.

Control: Start from system behavior and central questions. Require exclusions and signature verbs. Reject art or copy that merely applies familiar genre skins.

### Direct historical copying

Risk: Mortal timelines become Rome, the French Revolution, Byzantium, or imperial China with altered species and names.

Control: Mark current timelines `risky / needs review` and project-specific. Track inspiration and transformation distance. Rewrite causal structures, institutions, chronology, symbols, and names before canon promotion.

### Overengineering too early

Risk: Schema breadth, graph features, or automation delay the first useful browser.

Control: Build artifact inventory, status clarity, relationships, search, project usage, and decision logs first. Use JSON fields selectively until repeated patterns justify normalization.

### Mixing canon, strategy, and experiments

Risk: A product memo, unreviewed image, or monetization proposal is mistaken for world truth.

Control: Every record requires a layer, authority status, and source. Business strategy is never included in canon views by default. Imports begin as flexible inspiration or experimental unless an explicit decision says otherwise.

### Para Poker gambling and pay-to-win framing

Risk: Poker language, paid qualification, scarcity, or cash-equivalent rewards recreate wagering or transactional status systems.

Control: Treat Para Poker as a competitive information-and-identity game unless the user explicitly changes scope. No deposits, wagering, rake, purchasable competitive power, or paid-only advancement. Any prize, entry fee, cash-equivalent item, or legal-safety claim receives a blocking review flag.

### Provenance and rights

Risk: AI art, web references, Discord-hosted files, community work, and real-world symbols enter products without usable rights or attribution.

Control: Unknown rights default to internal reference only. Shipping use requires provenance and rights review. Community contributions require explicit consent, attribution, and license terms.

## Initial decisions still required

- Approve `Zynarth` as the canonical spelling and define whether `Xen'Dra` is a Zendra entity, manifestation, or retired spelling.
- Approve `Convergence` for abstract hybrids and reserve `Morphling` for embodied expressions.
- Confirm the product/world hierarchy among EGGS, Para, Paralleon, Reath, Mythic Strategies, and Egghead University.
- Decide whether Rumin, Sheen, Bizi, and Frumo remain active project directions after historical-distance rewrites.
- Classify Jali, Mekan, Gracus, and Indela as active, experimental, retired, or needs decision.
- Approve this specification and selected statements as foundation canon.
