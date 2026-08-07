# AGENTS.md — EGGS / Para Creative Archive

## Mission

This repository is the foundational creative systems archive for EGGS / Para games. It is an evergreen source of symbolic pressures, themes, mechanics, motifs, player identities, achievements, competitive meanings, and project-specific expressions.

It is not one finished story, one game's lore bible, a generic fantasy wiki, or a requirement that every game use the same factions literally.

Read `ARCHIVE_FOUNDATION_SPEC.md` before making structural, canon, schema, or app decisions.

## How to interpret the archive

- Read the archive as a creative operating system, not a pile of lore.
- Distinguish source artifacts from the concepts they contain.
- File presence, polish, repetition, folder placement, and age do not establish canon.
- Alien principles are symbolic engines. Mortal civilizations are local expressions.
- Future games may use archive concepts through lore, mechanics, player identity, achievements, cards, UI, profiles, competitive systems, motifs, or hidden design logic.
- A game should document material reuse. Copying only a name, color, or emblem is not meaningful reuse.
- A project may intentionally omit a principle. Do not force all concepts into every game.

## Current foundational direction

- Zynarth: swarm, pressure, appetite, consumption, multiplication, accumulation, and overwhelming presence.
- Voltari: law, order, control, hierarchy, structure, rank, procedure, and inevitability.
- Zendra: perception, influence, signal interpretation, belief, distortion, and meaning changing possible action.

Each principle needs both constructive and destructive expressions. Do not present any principle as simply good, evil, or equivalent to one real political group.

Use `Zynarth` as the working spelling, but keep the naming issue marked as needing user approval until a decision log records it. Do not silently rewrite source artifacts.

## Morphlings, convergences, and Astral Vanguards

- A convergence is the abstract interaction of two or more principles.
- A Morphling is a specific embodied hybrid expression of a convergence.
- Morphlings are not generic shapeshifters, miscellaneous mutants, or permission for arbitrary mixtures.
- Every Morphling must identify its component principles or convergence.
- Astral Vanguards are outsiders, entrants, explorers, observers, archivists, or interveners who recognize patterns across worlds.
- Astral Vanguards are not a fourth alien principle and are not automatically heroes or moral authorities.
- Preserve their tension around consent, intervention, interpretation, and ownership.

## Canon and review

Store canon authority separately from review condition.

Authority statuses:

- Foundation canon
- Project canon
- Strong direction
- Flexible inspiration
- Experimental
- Retired

Review flags:

- Contradictory
- Risky / needs review
- Needs user decision

Do not promote anything to foundation canon without explicit user approval and a decision log entry. Project canon must name its project scope.

Preserve retired and contradictory ideas. Keep them searchable, explain why they were retired, and link replacements. Do not delete, conceal, reactivate, or present them as current without a new decision.

## What not to do

- Do not flatten principles, civilizations, organizations, and player affiliations into interchangeable “teams.”
- Do not turn the setting into generic bug aliens, robot empire, psychic cult, and shapeshifters.
- Do not write generic fantasy copy to disguise weak system logic.
- Do not assume every idea is canon.
- Do not over-polish before resolving definitions, relationships, and scope.
- Do not explain every event automatically through all three principles.
- Do not make player identities accusatory, diagnostic, or politically insulting.
- Do not copy real historical timelines, nations, religions, symbols, conflicts, or atrocities with renamed surfaces.
- Do not treat uncurated concept art as an approved visual bible.
- Do not claim that a payment, prize, tournament, rights, or legal structure is safe without appropriate review.

## Para Poker guardrails

Treat Para Poker as a competitive, poker-inspired game of information, pressure, reads, identity, history, and rivalry—not as gambling—unless the user explicitly changes its scope.

- No deposits, wagering, rake, cash-equivalent chips, or purchasable competitive power.
- No paid-only advancement, qualification, legitimacy, or leaderboard weighting.
- Do not describe payments as optional while making them structurally required.
- Prefer earned titles, career records, rivalries, skill achievements, symbolic badges, and season history.
- Flag entry fees, prizes, tickets, cash equivalents, scarce paid XP, and legal-safety claims as risky and requiring user decision plus qualified review.

## Historical and visual material

Rumin, Frumo, Bizi, and Sheen contain strong systemic ideas but currently rely heavily on direct Roman, French Revolutionary, Byzantine, and imperial Chinese parallels. Treat their current timelines as project-specific material needing transformation review, not foundation canon.

Record provenance for art and references. Unknown rights default to internal reference only. Track creator, source URL, AI generation, model/prompt when known, license, checksum, and project use. Do not overwrite source files to make them appear cleaner.

## Current index

`Index/creative_asset_system_index.xlsx` is the existing organizational scaffold and migration source, not the final taxonomy.

Preserve:

- Master inventory behavior
- Browsable filtered views
- Purpose, tone, subject, and status labels
- Source-file traceability

For app work:

- Replace filename keys with stable IDs.
- Use workspace-relative paths.
- Treat the `assets` sheet as a generated view, not a second source of truth.
- Separate entities, relationships, canon authority, review flags, provenance, and rights.
- Preserve workbook sheet/row references during migration.
- Validate shifted names, paths, duplicates, zero-filled blanks, and missing tags.
- Never infer canon during import.

## Future app work

The Astro app at the repository root is a static Creative OS with three linked modes:

- Archive/system mode uses records in `src/content/archive/` validated by `src/content.config.ts`.
- Remediation/workbench mode parses `REMEDIATION_BACKLOG.md` through `src/lib/backlog.ts`; do not duplicate those tasks into a second data source.
- Pipeline mode uses JSON collections in `src/content/artifacts/`, `src/content/import-batches/`, `src/content/export-bundles/`, and `src/content/pipeline-tasks/`.
- Archive records link to remediation IDs and decision IDs in frontmatter.
- `src/pages/archive/[id].astro` and `src/pages/workbench/[id].astro` provide the connected detail views.
- `scripts/generate-exports.mjs` creates portable JSON, CSV, and Markdown bundles in `public/exports/` before each production build.
- The current production build emits static pages and generated downloads to `dist/` without requiring a database or server runtime.

Pipeline source rules:

- New untouched files enter through `imports/raw/`.
- Reversible derivatives may live in `imports/processed/`.
- Only reviewed, publishable artifact copies belong in `public/artifacts/`.
- Everything in `public/` may ship in a static deployment; do not place private, unlicensed, or unresolved-risk sources there.
- Artifact metadata is not evidence of publication permission. Unknown rights default to internal-only.
- Update export definitions and the generator together so every displayed download has a real static output.

Run Astro checks and the production build after changing schemas, routes, or content. Keep the app read-heavy and content-first before adding persistence or administration.

Current first-version scope:

1. Import workbook and filesystem artifacts without destructive moves.
2. Browse principles, convergences, Morphlings, Vanguards, civilizations, motifs, mechanics, archetypes, projects, guardrails, and artifacts.
3. Display authority and review badges prominently.
4. Support typed relationships and backlinks.
5. Search and filter by layer, type, project, principle, status, risk, rights, and reuse channel.
6. Record project usage and intentional omissions.
7. Maintain an append-only decision log.
8. Provide queues for contradictions, risky material, unknown rights, and user decisions.

Continue to defer generative lore tools, public profiles, telemetry, recommendation engines, payments, marketplaces, full admin workflows, and complex graph visualizations until classification and retrieval are proven useful.

## Working practice

- Preserve raw sources and unrelated user changes.
- Prefer additions and reversible migrations over destructive rewrites.
- Cite the artifact or decision supporting a classification.
- When evidence is unclear, use flexible inspiration, experimental, or needs user decision.
- Record meaningful renames, merges, splits, promotions, retirements, and guardrail changes in the decision log.
- Keep foundation definitions concise. Put examples and project variations in linked records.
- When designing a player-facing use, state the positive promise, observable behavior, shadow risk, and anti-pattern.
- When translating a principle into mechanics, identify concrete verbs and player decisions; thematic naming alone is insufficient.
