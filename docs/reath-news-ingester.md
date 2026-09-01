# Reath Digest News Ingester

Status: V1 production architecture
Jurisdiction: New Jersey
Database authority: Supabase `okqkljexfzolzxysjaha` only

## Purpose

The ingester turns permitted feed metadata from New Jersey journalism and public sources into an internal editorial desk. It collects source items, removes exact duplicates, groups related coverage into conservative story/event clusters, and presents editors with Reath Wire. Optional AI may enrich a Story after the deterministic core has done that work. It does not write or publish journalism.

The invariant is:

```text
sources -> source_items -> exact deduplication -> deterministic clustering -> stories
                                                                       |
                                                                       +-> editorial queue -> Reath Wire
                                                                       |
                                                                       +-> optional Story-level AI enrichment
                                                                                      |
                                                                                      +-> editorial triage -> Reath Wire
```

Articles are evidence. Stories/events are the primary editorial objects. Five articles about one event should normally become one story with five attached source items and, at most, one current basic enrichment opportunity. LLM calls scale with meaningfully changed Stories and explicit editorial need, not with raw article volume.

## Repository placement

This repository already uses pnpm, Astro, Netlify Functions, Netlify Identity, and Supabase. Reath therefore uses:

- Astro static pages for the internal Reath Wire shell.
- A fail-closed Netlify Function API for authenticated editorial reads and mutations.
- A protected Netlify background function invoked only by the authenticated **Run ingestion** action for RSS/Atom ingestion and deterministic reconciliation. Supabase Cron and the former Netlify scheduled dispatcher are disabled.
- Durable AI request state plus a separate token-protected background function for editor-requested enrichment and source comparison. The editor-facing request records work and returns before any provider call runs.
- Supabase Postgres as the canonical internal data and audit store.
- Pure JavaScript modules for URL normalization, parsing, clustering, geography, and enrichment so they can be fixture-tested outside the network and database.

The legacy Creative OS schema in the authorized disposable project is replaced by a forward migration. Supabase-managed schemas are not dropped. The live Para/EGGS project `uzderzjbitmghfvrllvz` is never linked, read, or mutated by Reath code.

## Layer 1: zero-AI core

AI is an optional intelligence layer, not a dependency of ingestion or editorial triage. With `REATH_AI_ENABLED=false`, no provider credentials, or an unavailable provider, Reath must continue to:

- poll RSS, Atom, and permitted API sources and detect new items;
- normalize URLs and headlines, preserve source metadata and chronology, and perform GUID, canonical-URL, and content-hash deduplication;
- perform basic New Jersey geography lookup and conservative deterministic Story clustering;
- create a separate Story when attachment confidence is insufficient;
- maintain the editorial queue and Keep, Watch, Ignore, merge, and detach workflows;
- report source health; and
- display a useful Reath Wire.

The absence or failure of AI must never fail the application, abort an ingestion run, prevent a source item from being processed, or hide the deterministic Story record. The API and Reath Wire expose AI as disabled, unavailable, pending, stale, current, or failed as appropriate while keeping deterministic fields usable.

## Data model

### Registry and ingestion

- `sources`: editable registry of RSS/Atom/API sources, cadence, rights/editorial notes, scope, and health.
- `source_assessments`: append-audited human assessments of source role, review status, generic verification tier, and a stable ownership/editorial-control group. A current row may be superseded but not rewritten or deleted. Polling priority and `source_type` are never credibility scores.
- `source_items`: normalized feed records. No publisher article body is stored. Exact duplicate constraints cover source GUID, canonical URL, and source/content hash.
- `ingestion_runs` and `source_run_results`: run- and source-level counts, duration, status, and errors.

`source_items.processing_status` includes a short-lived `processing` claim state. Each claim has an opaque token and start time; completion and error writes must match that token, so an expired worker cannot overwrite a newer recovery. `start_ingestion_run` serializes admission, fails workers beyond the platform window, and returns the existing fresh run instead of admitting an overlap. A partial unique index provides a second database fence. `finish_ingestion_run` changes only a still-`running` row, so a late worker cannot overwrite a reconciled failure. A later admitted run reclaims stale `processing` items through a bounded oldest-first backlog pass.

Story creation or selection and the initial `story_sources` evidence attachment run in one claim-checked transaction. A process termination cannot commit an empty new Story between those two steps. Recovery reuses an existing active evidence link, but a detached-only link remains detached and is never reattached automatically; the human editorial decision is authoritative.

### Editorial object

- `stories`: canonical event/topic clusters with conservative clustering confidence, activity timestamps, and a database-maintained monotonic `evidence_revision` used as an AI concurrency fence.
- `story_sources`: audited many-to-many attachments with method, confidence, signals, actor, and timestamp.
- `story_counties` and `story_municipalities`: normalized geographic links.
- `counties` and `municipalities`: first-class New Jersey reference geography. Counties include all 21 counties; municipalities are generated from the State of New Jersey municipality dataset and retain Treasury/federal codes.

### Analysis and human authority

- `story_enrichments`: validated structured librarian/research-desk output, provider/model/schema versions, input fingerprint, freshness/status/error state, and deterministic or AI provenance.
- `story_scores`: separately visible editorial dimensions and short reasons. There is intentionally no hidden aggregate importance score.
- `editorial_queue`: current state (`new`, `watch`, `keep`, `ignore`) and optional route (`digest`, `civic_relay`, `funnies`, `longform`).
- `editorial_decisions`: append-only audit of state, routing, merge, and detach decisions.
- AI operation records: an observable audit of provider, configured/requested `model`, provider-returned `model_version`, operation, Story ID, call time, result, latency, fingerprint, cache/existing-result disposition, and provider-reported token or cost-relevant usage. Deep-analysis results remain internal editorial metadata.

## Ingestion lifecycle

1. Select active sources whose last check plus poll interval is due.
2. Fetch each source with an explicit Reath user agent, redirect limit, response-size limit, and timeout.
3. Parse RSS 2.x or Atom through the shared adapter.
4. Normalize URLs, headlines, descriptions, dates, GUIDs, authors, and limited feed metadata.
5. Check deterministic identity signals and insert only unseen source items.
6. Mark new items `pending`; process each without allowing one source or item failure to abort the run.
7. Update source success/error timestamps, failure streak, counts, and a per-source result row.

Feed-provided descriptions are converted to bounded plain text. `content:encoded`, full article bodies, and arbitrary fetched article HTML are not retained.

Per-source adapters may include or exclude reviewed category, URL-route, title-pattern, or byline rules before registration. This permits a mixed feed to contribute only the reporting desk, section, or original newsroom bylines that were actually assessed, while rejecting clearly labeled sponsored, promoted, advertorial, opinion, digest, press-release, institutional, or syndicated entries. The New Jersey Business Magazine registry entry points to the publication's dedicated NJB News Now RSS route rather than its empty generic WordPress feed, while still excluding labeled non-editorial material. That entry is inactive because the official route returned HTTP 403 from the production Netlify worker; reactivation requires publisher-approved production access and a fresh parser validation. Source rights notes remain metadata-and-link only.

### Reviewed New Jersey provider expansion

The reviewed registry contains 78 assessed Sources, of which 72 are active. Sixty-four active endpoints have a current reviewed `independent_journalism` assessment at verification tier 2 or 3, representing 57 independent ownership/editorial-control groups. This is a literal expansion of the number of journalism providers Reath checks and rates, not merely a change in scoring. The first expansion added 27 active RSS endpoints:

- local and statewide newsrooms: Chalkbeat Newark, Ridge View Echo, The Jersey Vindicator, New Jersey Hills Media Group, Brick Shorebeat, Toms River Shorebeat, Lavallette-Seaside Shorebeat, Town Topics, Ocean City Sentinel, Pine Barrens Tribune, Essex News Daily, Union News Daily, The SandPaper, The Observer, The Press Group, Star News Group, Two River Times, The Coaster, and 42Freeway; and
- high-overlap regional newsrooms: New Jersey 101.5 News, PIX11 New Jersey, CBS News Philadelphia - New Jersey, CBS News New York - New Jersey, NBC10 Philadelphia - New Jersey, NBC 4 New York - New Jersey, 6abc - New Jersey, and ABC7 New York - New Jersey.

The next reviewed expansion adds Jersey Digs, The Village Green, MyVeronaNJ, WRNJ Radio, HudPost, Black In Jersey, Follow South Jersey, Slice of Culture, The Montclarion, The Rider News, The Whit, and WBGO News - Newark Today. Commercial, institutional, syndicated, opinion, entertainment, and non-news entries are excluded by reviewed category, URL, title, and byline rules where necessary. Student newsrooms qualify only through their News desks; they remain tier 2 and are not silently elevated to the same assessment tier as established public media.

The third expansion adds the publisher-operated FOX 29 Philadelphia and FOX 5 New York New Jersey feeds plus the independent Camden-Burlington newsroom 70and73. The Fox endpoints share one `fox-television-stations` control group and therefore count once for corroboration. Weather, sports, lifestyle, rankings, and shopping-style Fox entries are excluded. The 70and73 adapter accepts only the outlet's own bylines so New Jersey Monitor and NJ Spotlight stories syndicated into that feed cannot masquerade as another independent account. These additions poll at 12-hour or daily intervals; the six-hour scheduler only selects them when due, so breadth does not create frequent external calls.

The registry also includes Jersey City Times on its news feed with a reviewed tier-2 assessment. The six disabled Sources are 511NJ Active Events, BreakingAC, Hudson County View, New Jersey Business Magazine, Route 40, and Star News Group. Star News Group retains its journalistic assessment but is operationally disabled after nine consecutive production HTTP 403 responses and zero ingested items; this avoids paying to repeat a known-blocked request. These counts and the disabled set are registry assertions for verification; a feed that later fails rights, provenance, parser, or health review remains eligible for fail-closed deactivation.

Endpoint breadth is not evidence independence. Sibling feeds remain one qualifying group under their reviewed ownership/editorial control: the three Shorebeat feeds count once, Essex News Daily and Union News Daily count once, the two CBS feeds count once, the two NBC feeds count once, the two Fox feeds count once, and 6abc and ABC7 New York count once. The assessment's `corroboration_group_key`, not Source-row or article count, determines independent provider evidence.

New Jersey scope is enforced before registration wherever a regional feed mixes jurisdictions. Chalkbeat Newark, New Jersey 101.5, PIX11, and the NBC feeds use dedicated New Jersey category or tag routes; the CBS and ABC adapters require an explicit New Jersey feed category. Source-specific exclusions continue to reject labeled opinion, sports, weather, sponsored, advertorial, obituary, entertainment, and other non-news material as configured. The expansion is intended to create more opportunities for independently corroborated Stories; it does not relax the corroboration gate, authorize automatic publication, or treat a larger raw article count as verification.

## Exact deduplication

Exact duplicate detection is separate from story clustering:

- same source plus external GUID;
- same canonical URL after tracking-parameter removal;
- same source plus deterministic content hash.

Database constraints are the final race-condition guard. A repeated ingestion run may update source health but must not create another source item.

## Layer 2: cheap Story clustering

The clustering interface scores recent candidate Stories before any LLM is considered. Cheap signals include normalized headline and important-term overlap, deterministically extractable proper nouns and organizations, municipality/county overlap, dates, publication-time proximity, and source diversity. The bounded candidate window is anchored to the incoming item's publication time, falling back to discovery time, rather than the worker's wall clock; historical items from a newly added feed can therefore find coverage published in the same 72-hour event window. Strong matches attach to the candidate Story; otherwise the item creates a new Story. Ambiguity fails closed into a separate Story because false separation is preferable to an incorrect merge.

Conservative stable-anchor matching can join independently worded reports without lowering the ordinary clustering threshold. Fatal-incident matching requires the same fatal outcome, incident type, participant class, and a non-conflicting participant count. Named-event matching requires the same named person or institutional anchor, compatible action, and stable event facts. Exact named-person matches may bridge missing geography only across independent reviewed provider groups; enacted-law and civil-settlement coverage may substitute an explicit statewide-event context. A local-event fingerprint can also join reports within 36 hours when they come from independent control groups, resolve to the exact same municipality, and share at least three distinctive headline anchors without conflicting numbers. Generic locality, council, police, school, plan, or reporting words are excluded from that fingerprint. County-only overlap, a generic death/fire/arrest term, a conflicting person, number, fact, or event type is insufficient. Source diversity continues to use reviewed evidence-origin groups, so sibling or syndicated reports cannot turn a semantic match into independent corroboration.

Recurring same-source edition titles receive an additional conservative guard. When both headlines contain comparable but disjoint calendar dates, the Story already contains that Source, and the date-stripped titles are at least 90% similar, that candidate is ineligible. Equivalent forms such as `Aug 24, 2026`, `August 24`, and `8/24/26` remain compatible, while a second outlet or a substantively changed headline is not blocked by this edition-specific rule. This favors a reversible false separation over silently combining two date-labeled editions.

Production calibration extended that rule to named date ranges after New Jersey Stage's adjacent `August 18-24` and `August 25-31` weekly editions falsely merged at confidence `0.700`. Range endpoints now inherit the stated month/year, the whole range is removed for the template comparison, and disjoint same-source ranges fail closed. A second observed template, `<performer> LIVE! at <venue>`, merged different performers at one venue at confidence `0.704`; when the venue is effectively identical but the performer terms do not overlap, the same-source candidate is now ineligible. Cross-source corroboration is not blocked. Regression cases preserve equivalent date-range forms, different-source evidence, and materially different follow-up headlines.

Every attachment records method, score, and signal details. Editors can merge two stories or detach an incorrect source. Merge preserves all provenance, moves source/geography links, records the decision, and marks the merged story rather than silently deleting history.

### Bounded historical reconciliation

A scheduled reconciliation pass may repair earlier deterministic false separations using the same evidence-anchor scorer. It is limited to untouched, machine-built `developing` Stories: the queue must still be `new` with no route, notes, or human decision metadata; there may be no human editorial decision, AI state, AI attempt, analysis result, or detached evidence; and every active evidence link must have been created by the deterministic system from a current reviewed tier-2-or-higher independent-journalism Source. A prior system reconciliation remains eligible so a multi-source event can converge across several bounded passes, but any human touch closes the Story to automatic repair.

Each proposed pair must pass the strong-anchor, publication-window, evidence-origin, confidence, and ambiguity checks, and the two Stories may contain no more than 12 active source items combined. Strong anchors include tightly bounded fatal-incident, named-event, and same-municipality local-event fingerprints, plus funding decisions that share a monetary amount, two-token project phrase, municipality, funding-action language, and the 72-hour event window. Compact monetary forms such as `$277M` and `$18B` normalize to their full amounts. Scheduled and editor-requested manual ingestion apply at most 12 pairwise merges per run; therefore the Run Ingestion action can activate newly corroborating evidence without waiting for the next schedule. Reconciliation has explicit `dry_run` and `apply` modes; every run and every applied or skipped attempt is append-audited. Apply mode locks and rechecks both Stories, their evidence revisions, exact source-item sets, machine-only history, and independent origins before moving evidence. It retains the original Story and attachment provenance, marks the false-separated Story as merged, and writes system reconciliation decisions rather than impersonating an editor merge.

An applied merge transaction also leaves a durable source-item recovery marker before deterministic Story projections are refreshed. If the immediate refresh cannot complete, normal ingestion backlog recovery retries it; the marker is cleared only by a guarded completion step after the refreshed evidence state is durable. Reconciliation never changes a human queue decision, assigns a publication route, or publishes content.

The clustering implementation remains behind an interface so its scoring can evolve. Later semantic or model-assisted signals may help resolve ambiguous candidates, but they do not replace exact duplicate detection or the deterministic-first gate.

Embeddings are not a V1 prerequisite. If introduced later, they may improve semantic clustering or search, but deterministic identity constraints and auditable attachment signals remain authoritative. Reath does not add vector infrastructure merely because the database supports it.

## Layer 3: Story-level enrichment and scoring

The deterministic core derives bounded structured context from headlines, feed descriptions, source metadata, normalized geography, and explicit keyword maps. It is the normal no-AI path, not an error fallback.

When AI is enabled and capacity is available, the basic LLM unit is a Story, never each source article. Provider-specific code is isolated behind a small service contract such as:

```text
StoryEnrichmentProvider
  enrichStory(...)
  compareStorySources(...)
```

V1 supplies an OpenAI adapter behind this contract; the ingestion pipeline and Reath Wire do not depend on that implementation and tests substitute a fake provider. A later Anthropic, Gemini, or compatible-gateway adapter can implement the same contract without changing deterministic ingestion. All provider output must pass the same strict structured-schema validation before it can become current editorial metadata. Malformed output is rejected, the failure is recorded, historical results remain auditable, the deterministic projection stays active, and ingestion continues.

Visible enrichment may include New Jersey relevance, scope, counties, municipalities, topics, people, organizations, event type/date, public impact, civic utility, novelty, human interest, emotional register, Reath potential, satire potential, confidence, and why the Story may matter. AI output is internal research-desk metadata, not publishable copy.

Visible scores remain separate: local impact, civic utility, significance, momentum, novelty, human interest, emotional resonance, Reath potential, satire potential, locality, and confidence. Coverage count is context, not a definition of importance.

### Corroboration gate

The hard gate is unchanged: automatic desk priority above **Low Signal** requires one of two transparent evidence routes:

- at least two distinct reviewed journalism evidence groups with `independent_journalism` assessments at verification tier 2 or higher; or
- at least three distinct current reviewed reputable evidence groups at tier 2 or higher, including at least one journalism group. Reputable groups may be independent journalism, official primary sources, or institutional primary sources.

Evidence groups normally use each reviewed ownership/editorial-control group. An exact recognized wire/news-service byline, or an explicit compound credit that names the service at the beginning or end of the byline, instead collapses to that shared origin. Reprints attributed to New Jersey State House News Service, Associated Press, or Reuters therefore count once across outlet domains; one provider also cannot multiply corroboration by carrying several wire copies. A mere mention inside an unrelated byline does not collapse provenance, and unrecognized or individual bylines retain the reviewed provider group instead of being guessed into a shared origin.

Repeated items from one Source, sibling feeds under one control group, same-origin syndication, detached evidence, provisional assessments, aggregators, contextual sources, advocacy, and excluded sources do not increase the qualifying count. Official or institutional evidence remains explicitly attributed and can never satisfy the route without journalism. Corroboration means the Story is suitable for higher editorial attention; it is not a declaration that every claim is true. Keep, Watch, and Ignore remain authoritative human overrides.

Deterministic public-impact scores no longer receive a raw article-count bonus. Momentum and confidence use reviewed independent groups rather than item volume, and automatic AI enrichment is not queued for a low-signal Story. An editor may still explicitly request analysis. Reath Wire hides Low Signal by default, exposes an opt-in audit filter, shows item/provider/journalism/reputable-group counts, and ranks the full filtered Story set before applying its response limit.

### Material-change gating and fingerprints

Reath stores an enrichment result and does not call a provider merely because the scheduler ran again. The input fingerprint is the SHA-256 identity of the canonicalized exact evidence object passed to the provider, not a larger or looser proxy. That object contains bounded Story fields, sorted geography and organizations, an all-source inventory count/digest, and a deterministic recency-ordered selection of at most 25 active source items; each feed description is capped at 1,500 characters. Enrichment and Compare Sources use the same evidence builder, so source selection, ordering, and values used for gating match the provider input.

The `input_fingerprint` identifies evidence. A separate `cache_key` adds the operation, enrichment version, schema version, prompt version, provider, and model. This makes a provider/model or intentional version change eligible without pretending the underlying Story evidence changed.

The fingerprint/cache key is the semantic reuse identity; `stories.evidence_revision` is the database concurrency identity. Triggers increment the revision when material Story fields change; an active source is attached, detached, or reattached; a linked source item's source, headline, normalized headline, description, publisher, canonical URL, publication time, or content hash changes; a linked source registry's name or source type changes; county or municipality links change; or a current deterministic enrichment is inserted. Source and source-item updates increment every actively linked Story. `story_ai_state` pins both current and claimed revisions, and each basic/deep call attempt pins the revision it was created against. This lets the database detect evidence mutation immediately, even before the scheduled reconciliation has recomputed a fingerprint and updated AI state.

AI context assembly uses a stable double-read snapshot. It reads the Story and its revision, loads active source evidence, geography, and current deterministic organizations, then rereads the Story revision; it accepts the evidence only when both revisions match, with at most three snapshot attempts. The basic `request_story_ai_enrichment` and deep `request_story_analysis_attempt` RPCs receive that expected revision and lock/recheck the live Story before changing durable state. A mismatch raises the application precondition SQLSTATE `PT412`, which PostgREST exposes as HTTP 412; it is not a PostgreSQL serialization failure. The orchestrator reloads the context, recomputes the complete identity, and retries the request at most three times. Repeated evidence churn fails safely before a provider call and leaves deterministic output available.

A Story is eligible for basic enrichment when:

- it has no successful result for the current evidence and cache identity;
- the exact provider evidence changes, including an attach/detach, source-content change, Story field, material geography, or deterministic organization change;
- an editor explicitly requests refresh or reanalysis;
- the previous enrichment failed and its durable retry delay has elapsed; or
- the enrichment, schema, prompt, provider, or model configuration intentionally changes.

For automatic ingestion/configuration work, those reuse conditions are necessary but not sufficient: the Story must also pass the corroboration gate. Explicit editor refreshes and editor-authoritative Keep/route work remain permitted.

An unchanged scheduled identity consumes no provider call. An editor refresh receives the highest priority, but an identical pending or running request is coalesced into the existing generation instead of creating another one. An exact matching success requested again within the 60-second refresh cooldown uses the single `record_story_ai_enrichment_cache_hit` RPC to lock and validate the Story revision, AI state, complete identity, cooldown, and current enrichment before atomically inserting a completed `cache_hit` call-attempt row linked to that enrichment, with `provider_called=false`; no background dispatch or provider call occurs. If the revision or cache identity changed, the RPC raises `PT412` and inserts nothing, and the endpoint falls through to the normal expected-revision queue/retry path. After the cooldown an editor may intentionally force a fresh attempt. Stored state records the requested/successful generation, fingerprints, cache identity, versions, provider/model, lease-safe status, timestamps, and bounded error metadata.

Both the scheduled `claim_story_ai_enrichments` RPC and the single-Story editor `claim_story_ai_enrichment` RPC bind the expected enrichment, schema, and prompt versions plus provider and configured model; work queued for another configuration is not claimed. The worker repeats that configuration check, reloads the Story, and recomputes its fingerprint before creating an attempt. Basic call-attempt creation is a lease-checked RPC keyed by a preallocated UUID: replay/reconciliation returns the same identity rather than creating a second attempt, while a claim is rejected if its requested generation, current evidence revision, or current input fingerprint advanced beyond the values pinned when it was claimed. A separate idempotent provider-begin transition verifies the live lease, generation, evidence revision, and fingerprint before setting `provider_called`. Basic and deep workers may retry this database control transition once after an ambiguous failure; the RPC reconciles an already-committed begin for the same live lease, so the retry never constitutes or authorizes a second model request. Context, configuration, attempt-identity, lease, or begin validation failure closes/releases the claim without invoking the provider; a malformed response after a real call is recorded as `rejected` rather than accepted as metadata.

Basic and deep completion both read and lock the live Story revision, then AI state, then the call attempt. They reject or skip output when the pinned revision differs from `stories.evidence_revision`, even if the worker has not yet reconciled the state row, and also guard the claimed generation/fingerprint and operation identity. This shared Story → state → attempt lock order avoids opposing basic/deep completion lock cycles. Only a successful result whose evidence, fingerprint, and enrichment/schema/prompt/provider/model configuration remain current can become the active AI projection. If AI is disabled or unavailable, configuration is stale, or work is pending, running, or failed, the API and Reath Wire use deterministic enrichment/scores while retaining AI history and an explicit AI status. Once the configured provider is available, an editor-initiated batch may perform bounded basic-enrichment reconciliation that queues evidence-revision and configuration mismatches for refresh. A mismatched basic request is never claimed with the wrong provider or model; it remains durable and is requeued under the current identity when processing can resume.

## Layer 4: selective deep analysis

Deeper and more expensive reasoning is separate from basic enrichment. In V1 it runs only after an explicit editor request; Keep/route state can prioritize basic enrichment but does not itself invoke a deep-analysis provider call. Ordinary low-priority and repetitive Stories therefore receive no automatic deep call.

Supported editorial operations may include:

- **Compare Sources (implemented in V1):** agreement, differences, primary-source origins, disputed claims, unknowns, and a development summary;
- **Story Development (extension point):** what materially changed and whether coverage represents a new development; and
- **Editorial Context (extension point):** why New Jersey residents may care, affected populations, and useful reporting questions.

Opening a Story does not itself call a provider. Compare Sources requires at least two distinct active Sources; repeated items from one Source are not a comparison. One database RPC, `request_story_analysis_attempt`, holds the Story lock while it atomically expires an abandoned lease, coalesces the complete matching active identity, supersedes a stale queued or pre-provider running identity, returns a complete-identity cache hit, or inserts one durable queued request. After superseding a queued or pre-provider identity, it rechecks any surviving provider-called running attempt and coalesces when that complete identity matches. The identity includes evidence revision, fingerprint, cache key, enrichment version, provider, configured model, schema version, and prompt version, so concurrent editor requests cannot race those decisions in application code.

A running comparison with `provider_called=true` is not canceled: its provider request and lease continue, and the separate one-running/one-queued constraints allow it to coexist with at most one durable queued successor. A newer editor request can coalesce with or atomically replace that queued successor. Completion compares the running identity with the single newest later request, so an A → B → A request sequence accepts the already-running A result and does not queue or pay for a duplicate A call. Otherwise, when the older provider call completes, the database checks its pinned evidence revision, request/attempt fingerprint identity, and newer request sequence. Stale output is marked `skipped`/`superseded`, retains the provider response metadata and usage, and never creates a current `story_analyses` row. Scheduled deep selection filters enrichment version, provider, configured model, schema version, and prompt version, and `claim_story_analysis_attempt` rechecks the same identity under the Story lock. A mismatch is not claimed or sent to the wrong provider; it remains durable and inert. If that configuration returns, the work is still eligible, while a new editor request under the active configuration atomically supersedes the stale queued identity. Reath Wire renders a comparison result or attempt status only when it matches the live Story evidence revision and the active capability's enrichment-version/provider/model/schema/prompt identity. It does not depend on basic `story_ai_state`, so Compare Sources remains independently usable for preexisting Stories that have no basic-AI state row. Stale history remains available through AI Activity instead of appearing current. Agreements, differences, primary-source claims, and disputed claims carry `source_item_ids`; strict schema and provenance validation reject an unattached ID. Reath Wire resolves accepted IDs back to source headline, publisher, and URL, while the editor remains responsible for verification and use.

### Async editor flow and manual recovery

1. An authenticated, same-origin editor `POST` to Story enrichment or `compare_sources` first writes durable request/call state and attempts an editorial audit record. Audit-write failure is logged but does not discard queued work. The foreground request never waits for the model.
2. New or coalesced-pending enrichment returns `202` with `dispatchRequired=true` so a worker is still nudged; matching work already running returns `202` with `dispatchRequired=false`, and a refresh-cooldown cache hit returns `200`. Compare Sources uses the same queued/running dispatch distinction and returns a complete-identity cache hit with `200`.
3. When dispatch is required, the API sends the durable identifier to the token-protected `reath-ai-background` function. That worker claims a lease, reloads and verifies current evidence, makes the provider call, validates the structured result, and records success, rejection, failure, or supersession. If a provider-called comparison finishes superseded, the same background invocation immediately tries to drain at most one queued successor; it never recurses through an unbounded chain.
4. A missing or failed immediate dispatch does not erase queued work. The next editor-initiated ingestion completes deterministic ingestion first, then processes configuration-matching queued editor work within the remaining invocation budget. Deep and basic work share the same global per-run cap and 13-minute wall budget, so neither path may claim work after the completion reserve no longer fits. Each manual run performs bounded housekeeping for expired basic-enrichment and deep-analysis leases. Database-authored start fences, claims, and separate queued/running uniqueness constraints prevent an older or duplicate worker from overwriting newer editor/configuration work.

This protected background path depends on `REATH_SCHEDULE_TOKEN`: without that token neither the Run ingestion API nor the editor AI dispatcher can invoke its worker. The token does not create a schedule.

No production ingestion or reconciliation cron job remains. The manual-only migration unschedules both former Reath Supabase jobs and removes their Reath-owned cron history. The dormant Edge worker remains private but has no scheduler.

## Editorial lifecycle

Every new story receives an editorial queue row. Editors may Keep, Watch, Ignore, or return it to New, and may independently route it to Digest, Civic Relay, Funnies, or Longform. Routes are planning metadata only. No database trigger, API route, scheduled job, or UI action publishes content.

Reath Wire groups stories into desk-oriented sections and exposes filters, source chronology, source-assessment provenance, structured briefing fields, uncertainty, score dimensions, and provenance links. Low Signal is collapsed by default but remains auditable through an explicit filter. Source Health exposes last check/success, recent counts, failure streak, current source assessment, and last error.

AI never rewrites a fetched article into an automatically published Reath article. Machines collect, normalize, organize, compare, classify, and prioritize. Human editors interpret, frame, report, satirize, approve, and publish. Keep status or a route may raise analysis priority, but neither authorizes generation or publication.

## Permissions and security

- Reath Wire and its API are internal.
- Netlify Identity registration must be Invite only.
- The API uses `@netlify/identity` and accepts only server-controlled `app_metadata.roles` / normalized Identity roles.
- `editor`, `admin`, and `owner` can make editorial decisions; `viewer` may read; ingestion and story merge/detach require `admin` or `owner`.
- Authentication fails closed. There is no local-owner or invalid-token fallback in Reath code.
- The Supabase secret/service role key exists only in Netlify Functions. Browser code receives neither it nor direct table grants.
- AI credentials and gateway URLs are read only by the server-side provider adapter. They never appear in browser JavaScript, rendered HTML, `PUBLIC_*` variables, or Supabase public configuration.
- Every `public` table has RLS enabled. `anon` and `authenticated` have no Reath table privileges; the authenticated API uses the server role after Netlify authorization.
- State-changing API calls enforce same-origin requests in addition to authentication.

## Source-rights philosophy

The registry records rights notes per source. V1 stores URLs, canonical URLs, headlines, publisher/author/date, feed-provided bounded descriptions, feed metadata, derived classifications, editorial metadata, optional future embeddings, and Reath notes. It does not crawl article pages or retain `content:encoded`, images, or full publisher content. Declarative category/title exclusions remove explicitly labeled sponsored, advertorial, opinion, press-release, or recurring digest items where a vetted feed mixes them with reporting. Government or licensed sources may receive different rules only after an explicit source-level rights decision.

## Observability

Each run records totals, timing, trigger, and error summary. Each source records fetched/new/duplicate/error/deferred counts and duration. Clicking Run ingestion refreshes every active provider, not only providers whose former polling cadence is due. Before polling, a service-role-only maintenance RPC releases stale claims and deletes unlinked `pending`/`error`/`ignored` Source Items older than 30 days. Linked Story evidence is never deleted. Feed entries published before the same cutoff are marked ignored at the database boundary and filtered before insertion by the next deploy, preventing an aged processing backlog from being recreated. Exact article duplicates remain blocked by canonical-URL, source/GUID, and source/content-hash uniqueness constraints. Same-event Story duplicates are conservatively reconciled after ingestion, preserving all attached source provenance. One invocation processes at most 100 source items, uses a seven-minute deterministic claim budget, and retains time for reconciliation inside a thirteen-minute application deadline. A broken source cannot abort other sources, and Source Health makes failures visible.

Every queued deep operation and every actual provider attempt records evidence revision, enrichment version, provider, configured/requested `model`, operation type, Story ID, status, time, practical latency, input fingerprint, and error metadata. On completion, `model_version` separately preserves the model identifier returned by the provider, falling back to the configured model only when the response supplies none; cache hits carry both identities from the reused result. Explicit cache reuse creates a `cache_hit` ledger row linked to the reused enrichment or analysis, with `provider_called=false`; this currently covers the editor refresh cooldown and complete-identity Compare Sources reuse. `provider_called` therefore separates queue/cache activity from billable provider attempts.

If a provider-called result is superseded, malformed, or fails provenance validation, its returned model/version, provider request ID, latency, token counts, and usage metadata are still retained; the terminal state is `skipped` for stale output or `rejected` for invalid structured output. Failures before provider-begin remain `provider_called=false` and cannot masquerade as usage. AI Activity orders call attempts newest first and returns only the latest 100 rows. Its call, provider-call, success, failure, and cache-hit counts plus input/output token totals are calculated from that same `latest_100` window, not from all-time history. Each non-secret activity row exposes the full input fingerprint and cache key plus provider, configured model, provider-returned `model_version`, request identity, status, latency/timing, usage, and bounded error metadata; the UI presents this bounded activity response rather than implying lifetime totals.

`REATH_AI_MAX_STORIES_PER_RUN` is the hard ceiling for claimed AI jobs, and therefore provider attempts, in one manual ingestion batch. Configuration-matching, editor-requested deep comparisons consume slots first; basic Story enrichments use the remaining capacity. The batch uses the earlier of its own fixed 13-minute wall budget and the ingestion invocation's absolute deadline, and stops either path from claiming new work unless the configured provider timeout plus a 15-second completion reserve still fits. This bound does not cancel deterministic ingestion and prevents a runaway request from producing unlimited calls.

The OpenAI SDK is configured with zero automatic retries (`maxRetries: 0`). One claimed job therefore makes at most one SDK-level provider request. The one permitted retry of an idempotent database provider-begin control transition happens before that SDK request and only reconciles whether the durable authorization committed; it is not a provider retry. A persisted failed enrichment may become eligible after database backoff on a later editor-initiated run, or an editor may request another attempt; that deliberate later claim is observable and is not a hidden in-request retry. Provider timeouts and failures remain isolated from the completed deterministic core run.

When capacity is constrained, eligible work is prioritized approximately as follows:

1. editor-requested refresh or analysis;
2. kept or otherwise high-priority Stories;
3. recently active Stories that pass the corroboration gate;
4. older Stories that pass the corroboration gate; and
5. low-signal, repetitive, or ignored Stories only when an editor explicitly requests work.

Runtime logs contain source IDs/names, Story IDs, operation names, and counts, never secrets, prompt payloads containing unnecessary source text, or full feed payloads.

## Environment and operations

Required server-only variables for the deterministic runtime:

- `SUPABASE_URL`
- `SUPABASE_PROJECT_REF=okqkljexfzolzxysjaha`
- `SUPABASE_SERVICE_ROLE_KEY` (or supported Supabase server secret)
- `REATH_RUNTIME_CONTEXT`
- `REATH_ALLOWED_ORIGIN` for explicit production same-origin checks

Required for protected manual ingestion and immediate editor-requested AI dispatch:

- `REATH_SCHEDULE_TOKEN` (one long random server-only secret shared by the ingestion background worker, API dispatcher, and AI background worker)

The former `REATH_EDGE_SCHEDULE_TOKEN` and Vault copy are no longer operationally required because no Supabase job invokes the dormant Edge worker. No secret belongs in migrations, Git, browser code, or public configuration.

Optional ingestion controls:

- `REATH_INGEST_USER_AGENT`
- `REATH_FETCH_TIMEOUT_MS` (default `8000`)
- `REATH_MAX_FEED_BYTES` (default `2000000`)

The reviewed-provider expansion and deterministic clustering/reconciliation path introduce no new environment variables; they use the existing ingestion runtime and fetch controls.

Optional AI controls (defaults shown):

- `REATH_AI_ENABLED=false`
- `REATH_AI_PROVIDER=openai`
- `REATH_AI_MODEL=gpt-5-mini`
- `REATH_AI_MAX_STORIES_PER_RUN=10`
- `REATH_AI_TIMEOUT_MS=40000`
- `REATH_AI_ENRICHMENT_VERSION=1`

The `REATH_AI_*` values configure only the optional enrichment layer. Keep `REATH_AI_ENABLED=false` until the optional-AI database migration and server credentials are present; set it to `true` explicitly to activate provider work. With AI disabled, provider/model/key values are not required and all non-AI workflows continue. If AI is enabled but unavailable or misconfigured, Reath reports that capability state without making the core runtime unready.

When Netlify AI Gateway is enabled, Netlify injects `OPENAI_API_KEY` and `OPENAI_BASE_URL` into the server runtime. Without Gateway, configure `OPENAI_API_KEY` as a server-only secret; `OPENAI_BASE_URL` is optional for an explicitly selected compatible endpoint. Neither name, nor any provider secret, may use a `PUBLIC_` prefix or be exposed to the browser, rendered HTML, or Supabase public configuration.

The only admitted ingestion trigger is the authenticated admin/owner **Run ingestion** action in Reath Wire. The API queues one protected Netlify background invocation, which refreshes all active sources, applies the 30-day backlog policy, performs normal per-item Story matching, and runs bounded conservative reconciliation. There are no Supabase Cron jobs. Netlify production deploys are currently paused because the free team exhausted its deploy credits, so the immutable published deploy still lists its former six-hour scheduled entrypoint; the database returns `manual_only` before that invocation can create a run, poll a provider, or reconcile a Story. The next permitted Netlify deploy removes that entrypoint and increases the button-triggered reconciliation scan from the currently published 500-candidate/12-merge bound to the repository's 2,000-candidate/50-merge bound.

## Verification and acceptance

Fixture tests cover RSS/Atom parsing, URL normalization, deterministic identity, source isolation, Story creation/attachment, merge/detach planning, editorial transitions, enrichment validation, and fail-closed role enforcement. `pnpm db:check` always executes the complete Reath migration chain in PGlite's embedded Postgres/WASM runtime (with `pgcrypto`) and checks the real catalog, all-table RLS, role ACLs, reference counts, ingestion admission/finish/assignment fences, the date-edition calibration repair, revision/configuration races, scheduled state-version fencing, lease constraints, idempotent provider begin, stale deep-configuration replacement, and deep A → B → A supersession. When the authorized server environment is present it additionally probes the live project and, when an anon key is supplied, verifies anonymous table/RPC denial. A live check is reported as skipped—not passed—when those server-only credentials are absent.

AI acceptance tests use a fake/mock provider and never make live provider calls. They demonstrate that:

1. ingestion, clustering, the editorial queue, source health, and Reath Wire function with AI disabled;
2. unchanged exact provider input is not enriched repeatedly by scheduled work;
3. materially changed exact provider input or an explicit refresh can trigger re-enrichment;
4. malformed AI output is rejected safely without replacing valid metadata;
5. provider failure or timeout does not stop ingestion;
6. AI credentials are not required for non-AI workflows;
7. deep analysis is not automatically called for every Story or merely because a Story is opened;
8. provider enrichment passes strict structured-schema validation before persistence; and
9. provider implementations are replaceable and mocked through the provider interface.

Production-path coverage must also verify material Story/source/source-item revision-trigger invalidation; stable double-read evidence snapshots and bounded `PT412` expected-revision retries; atomic cooldown cache-hit recording; global bounded basic/deep lease cleanup without provider availability; database-time/optimistic fencing of scheduled configuration reconciliation; configuration-bound scheduled/editor claims and rejection when a claimed generation/evidence/fingerprint advances before provider start; lease-checked/idempotent provider begin and its single control-plane reconciliation retry; queue-only editor requests; full deep identity including enrichment version; atomic deep cache/coalescing/supersession, including A → B → A latest-intent reuse and active-config replacement of stale queued work; current-configuration Wire filtering; one-running/one-successor behavior; deep-first scheduled priority within the shared cap/wall budget; immediate bounded successor drain plus scheduled fallback; completion lock ordering; configuration-stale deterministic fallback and basic requeue without a wrong-provider call; the 13-minute wall guard; zero SDK retries; latest-100 activity summaries; cache-hit/provider-call/rejected-output accounting; source-comparison provenance rejection; priority/cap behavior; observable non-secret usage metadata; PGlite migration/RLS/ACL/race verification; and the absence of AI secrets from browser bundles and public configuration.

The acceptance principle is directional rather than a fixed ratio: 300 discovered articles may deterministically become 240 unique source items and roughly 55 Stories, producing 55 or fewer basic enrichment calls and perhaps 5–10 editor-selected deep-analysis calls. Calls must scale primarily with meaningful Stories and editorial need, not raw article volume.

## V1 implementation order

### V1A: useful zero-AI wire

```text
sources -> ingestion -> normalization -> exact deduplication
        -> deterministic/basic Story clustering -> Reath Wire
```

This path is independently deployable and must remain usable while later layers are unfinished or disabled.

### V1B: optional Story intelligence

```text
Story-level structured AI enrichment -> visible editorial dimensions
                                     -> smarter Reath Wire prioritization
```

V1B adds provider abstraction, material-change gating, validated results, call limits, and usage observability without changing the V1A availability contract.

### V1C: selective deep analysis

```text
editor-requested source comparison -> development summaries -> editorial context
```

These operations remain selective, auditable, and human-authoritative.

## Future expansion

Later versions may add embeddings, improved semantic clustering/search, entity resolution, richer dispute/unknown extraction, source-specific licensed adapters, queue notifications, personalization, or broader geography. Expansion beyond New Jersey, public feeds, automatic publishing, or article-body retention requires a separate product and rights decision. Embeddings never replace deterministic duplicate detection, and no later layer may delay or remove the usable zero-AI Reath Wire.
