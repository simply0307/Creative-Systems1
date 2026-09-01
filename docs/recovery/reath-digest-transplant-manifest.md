# Reath Digest content-transplant manifest

Status: recovery candidate; not merged, deployed, or applied to Supabase

## Authority and ancestry

- Read-only source checkout: `C:\Users\gjoep\OneDrive\Desktop\Creative Systems`
- Source branch and HEAD: `master` at `4b985bb15049d074d3c73d4367c26f844f1c92a2`
- Canonical repository: `https://github.com/simply0307/Creative-Systems1.git`
- Canonical base: `canonical/main` at `2ca0ef951628ceb344286d2413f7c2f40114cd9e`
- Recovery worktree: `C:\Users\gjoep\OneDrive\Desktop\Reath Digest Backend Recovery`
- Recovery branch: `codex/reath-digest-backend-recovery`
- Ancestry rule: the recovery branch is based directly on canonical `main`. The unrelated local `master` history was not merged, rebased, or cherry-picked.
- Source preservation: the dirty source checkout was read only. No reset, clean, stash, deletion, rewrite, or source-file edit was performed.
- Source `git status --short` inventory at both start and final audit: 187 entries comprising 37 modified entries, 6 deleted entries, and 144 untracked status entries representing 188 untracked files. The exact status-output SHA-256 was `c12183b5e77008a3be4425653f5c8b8ce0d0bf4de89b898a0f9deee900f76929`.
- Worktree cap: exactly two worktrees exist: the dirty source checkout and this recovery worktree.

## Included files

The following files are the complete content-transplant set. Paths not listed here were not transferred from the dirty source.

### Reconciled configuration and authority files

- `.env.example`
- `AGENTS.md`
- `astro.config.mjs`
- `docs/RUNTIME_AUTHORITY.md`
- `docs/recovery/reath-digest-transplant-manifest.md`
- `netlify/functions/lib/runtime-contract.mjs`
- `netlify.toml`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/pages/index.astro`
- `src/pages/pipeline/artifacts.astro` (removed as part of the Reath cutover)
- `src/pages/pipeline/index.astro` (removed as part of the Reath cutover)
- `src/generated/repo-import-manifest.json` (removed; generated Archive input is not part of Reath)
- `src/server/creative-os/handle-creative-os.mjs`

### Reath documentation and lint configuration

- `docs/reath-news-ingester.md`
- `eslint.config.mjs`

### Netlify runtime

- `netlify/functions/_shared/reath/ai-core.mjs`
- `netlify/functions/_shared/reath/ai-orchestrator.mjs`
- `netlify/functions/_shared/reath/ai-provider.mjs`
- `netlify/functions/_shared/reath/auth.mjs`
- `netlify/functions/_shared/reath/cluster.mjs`
- `netlify/functions/_shared/reath/config.mjs`
- `netlify/functions/_shared/reath/editorial.mjs`
- `netlify/functions/_shared/reath/enrichment.mjs`
- `netlify/functions/_shared/reath/feed-parser.mjs`
- `netlify/functions/_shared/reath/geography.mjs`
- `netlify/functions/_shared/reath/headline.mjs`
- `netlify/functions/_shared/reath/ingestion.mjs`
- `netlify/functions/_shared/reath/reconciliation.mjs`
- `netlify/functions/_shared/reath/signal.mjs`
- `netlify/functions/_shared/reath/source-adapters.mjs`
- `netlify/functions/_shared/reath/supabase.mjs`
- `netlify/functions/_shared/reath/url-normalizer.mjs`
- `netlify/functions/reath-ai-background.mjs`
- `netlify/functions/reath-api.mjs`
- `netlify/functions/reath-ingest-background.mjs`
- `netlify/reath-functions/reath-ai-background.mts`
- `netlify/reath-functions/reath-api.mts`
- `netlify/reath-functions/reath-ingest-background.mts`

The Reath runtime keeps the newer canonical `netlify/functions/lib/runtime-contract.mjs` implementation and adds only the dirty source's fail-closed rejection for a project ref other than `okqkljexfzolzxysjaha`. The older source readiness implementation was not imported.

### Static shell and Wire UI

- `public-reath/robots.txt`
- `src/layouts/ReathLayout.astro`
- `src/pages/wire/ai.astro`
- `src/pages/wire/health.astro`
- `src/pages/wire/index.astro`
- `src/scripts/reath-ai-client.js`
- `src/scripts/reath-auth-client.js`
- `src/scripts/reath-health-client.js`
- `src/scripts/reath-wire-client.js`
- `src/scripts/reath-wire-data.js`
- `src/styles/reath.css`

### Synthetic fixtures, local tools, and tests

- `scripts/fixtures/reath/atom.xml`
- `scripts/fixtures/reath/rss.xml`
- `scripts/generate-nj-geography.mjs`
- `scripts/reath-ai.test.mjs`
- `scripts/reath-database-check.mjs`
- `scripts/reath-edge-runtime.test.mjs`
- `scripts/reath-ingester.test.mjs`
- `scripts/reath-reconcile-stories.mjs`
- `scripts/reath-reconciliation.test.mjs`
- `scripts/reath-signal.test.mjs`
- `scripts/reath-wire-client.test.mjs`
- `scripts/reath-wire.test.mjs`
- `scripts/operations-api.test.mjs`
- `scripts/supabase-api.test.mjs`
- `scripts/sync-reath-edge-runtime.mjs`

### Supabase local configuration and Edge runtime

- `supabase/.gitignore`
- `supabase/config.toml`
- `supabase/functions/_shared/reath/cluster.mjs`
- `supabase/functions/_shared/reath/config.mjs`
- `supabase/functions/_shared/reath/enrichment.mjs`
- `supabase/functions/_shared/reath/feed-parser.mjs`
- `supabase/functions/_shared/reath/geography.mjs`
- `supabase/functions/_shared/reath/headline.mjs`
- `supabase/functions/_shared/reath/ingestion.mjs`
- `supabase/functions/_shared/reath/reconciliation.mjs`
- `supabase/functions/_shared/reath/signal.mjs`
- `supabase/functions/_shared/reath/source-adapters.mjs`
- `supabase/functions/_shared/reath/supabase.mjs`
- `supabase/functions/_shared/reath/url-normalizer.mjs`
- `supabase/functions/reath-ingest/deno.json`
- `supabase/functions/reath-ingest/index.mjs`

### Reath migration files appended to canonical history

- `supabase/migrations/20260822031655_convert_creative_os_to_reath_digest.sql`
- `supabase/migrations/20260822034810_add_optional_story_ai.sql`
- `supabase/migrations/20260826064130_harden_ingestion_recovery_and_ai_preconditions.sql`
- `supabase/migrations/20260826072430_split_spotlight_daily_edition_date_conflict.sql`
- `supabase/migrations/20260826080300_split_new_jersey_stage_recurring_event_conflicts.sql`
- `supabase/migrations/20260826090008_add_corroboration_signal_and_sources.sql`
- `supabase/migrations/20260826102000_harden_evidence_origins_and_business_feed.sql`
- `supabase/migrations/20260826151000_disable_netlify_blocked_nj_business_feed.sql`
- `supabase/migrations/20260826175800_expand_reviewed_nj_journalism_sources.sql`
- `supabase/migrations/20260826190000_add_safe_story_reconciliation.sql`
- `supabase/migrations/20260827161604_expand_reviewed_local_sources_and_reduce_polling.sql`
- `supabase/migrations/20260827171634_expand_verified_sources_and_event_matching.sql`
- `supabase/migrations/20260827183217_schedule_reath_edge_ingestion.sql`
- `supabase/migrations/20260827193340_manual_only_ingestion_maintenance.sql`
- `supabase/migrations/20260827195634_enforce_manual_ingestion_admission.sql`
- `supabase/migrations/20260827195857_enforce_manual_refresh_and_retention.sql`

## Mixed files reconciled hunk-by-hunk

| File | Reconciliation |
|---|---|
| `.env.example` | Kept canonical Creative OS guidance and local-owner controls; fixed the authorized project URL/ref and added only documented Reath server variables with placeholders. |
| `AGENTS.md` | Kept canonical Archive guidance; prepended the Reath authority and project-boundary rules. |
| `astro.config.mjs` | Added `publicDir: "public-reath"` so generated Archive exports are not emitted by the Reath build. |
| `docs/RUNTIME_AUTHORITY.md` | Kept canonical production and migrations 1–8 history; made Para/EGGS wholly out of scope and added an offline Reath-recovery boundary. |
| `netlify/functions/lib/runtime-contract.mjs` | Kept the newer canonical readiness RPC and cache implementation; added only a fail-closed rejection for any declared project ref other than the authorized Reath project. |
| `netlify.toml` | Selected the Reath function-wrapper directory and AI-off Reath contexts; removed redirects to functions that are not in that selected deployment directory. No schedule was added. |
| `package.json` | Kept canonical baseline/security/migration scripts; added Reath lint, typecheck, test, database, edge-sync, and reconciliation scripts plus their pinned dependencies. Reath build no longer generates excluded Archive exports/manifests. |
| `pnpm-lock.yaml` | Took the authoritative Reath dependency closure; frozen-lockfile verification must pass. |
| `pnpm-workspace.yaml` | Kept canonical build allowlists; added the source's hoisted linker and explicit ESLint release-age exception needed by the locked dependency graph. |
| `src/pages/index.astro` | Replaced the Archive landing page with the source Reath landing page. |
| `src/pages/pipeline/artifacts.astro` | Removed to prevent the retired Archive pipeline from remaining reachable in the Reath build. |
| `src/pages/pipeline/index.astro` | Removed to prevent the retired Archive pipeline from remaining reachable in the Reath build. |
| `src/generated/repo-import-manifest.json` | Removed. It is generated Archive input, not Reath source, and must not enter this branch or build. |
| `src/server/creative-os/handle-creative-os.mjs` | Removed the generated-manifest import and supplied a frozen empty historical catalog so preserved legacy API modules load without rebuilding unrelated Archive metadata. Those functions are not in the selected Reath deployment directory. |
| `scripts/operations-api.test.mjs` | Kept tombstone and safety coverage; replaced stale packaging and deleted-pipeline expectations with the Reath wrapper, public-directory, and exclusion boundary. |
| `scripts/supabase-api.test.mjs` | Kept runtime, authorization, schema, and helper coverage; replaced generated-manifest and removed-pipeline fixtures with synthetic/inert-catalog assertions, and added the non-authorized-project rejection test. |

Canonical Creative OS implementation files deliberately left unchanged include `docs/OPERATIONS_API.md`, `netlify/functions/creative-os.mjs`, `netlify/functions/lib/supabase.mjs`, the setup/import scripts and their remaining tests, `src/layouts/AppLayout.astro`, and `src/scripts/account-client.js`.

## Migration reconciliation

The eight migrations already in canonical `main` remain canonical blobs. Their LF-normalized SHA-256 values are:

```text
fa3c7351662fef9109e20870e078c2c414df63fdf47a6a2cb9e794dfc4f85095  20260715140231_creative_os.sql
c13dd5a691cb78a6ec23666b29344c3f25bafac6cd71f00e13da6846a96af8bf  20260715140306_artifact_organization_phase1.sql
5758cf02a840508c34d8f9c835d4ba74f847e5fe0a94e83f602aa726f07e163d  20260715140315_controlled_values_management.sql
a8b8ef466df0fdb25a91f0bae15fa01614a8c4042a18f9ee95731a516507d6d2  20260715140324_archive_index_folder_tags.sql
0758f78beeae7c3dfc1e5716af9652485906746a67d033f2568095e60037632f  20260720123053_add_authenticated_comment_resonance_votes.sql
3525e24a5919dd674f37b6899238985b62459a44b5cf1f7a72fe31ee62f08673  20260807101623_establish_runtime_contract.sql
aabaf3c904af55f9056d5c275747c2a742045af7b047a8da75513aac01b3a87f  20260807224000_harden_direct_function_privileges.sql
5c774c87daf311c5d3c4d455dd56c0bbb6035a4697e6adaff75f1da439130828  20260810032000_worker_budget_rpc.sql
```

The source duplicates of the last two have an extra semicolon or blank-line drift and were not copied. The sixteen appended Reath files retain these raw source/result SHA-256 values. "Appended" describes Git ordering only: the first Reath migration intentionally replaces the application schema and is not an additive SQL change.

```text
043bbdb976957cf2929d2cffde839e8ab7e97a9969319d761b06c04a84ab8b94  20260822031655_convert_creative_os_to_reath_digest.sql
a6efe2863d044be3326c5a76528936e517547013da2a46686c8942909492ad7e  20260822034810_add_optional_story_ai.sql
f558909a25d14285db9c3cc875b3347c05f9c22e3fc9298e328e184ad5be1040  20260826064130_harden_ingestion_recovery_and_ai_preconditions.sql
a87aad464ce89260e88d6f1443b52a0a23bcfebf0d669c7ad79afc2cfed1a1c5  20260826072430_split_spotlight_daily_edition_date_conflict.sql
361a4fecc1dcec21c5443ec392a62ce05f4223092ea35ce01a692ac42c2580a5  20260826080300_split_new_jersey_stage_recurring_event_conflicts.sql
e6318a5f397f036559d4902ed1d12cfac4895b5a4d903755c9f2ca42643927d2  20260826090008_add_corroboration_signal_and_sources.sql
a9dc6d6490249808985f7a7ca8bd3e6534bba0fa08415a9c11de75b44bc24c93  20260826102000_harden_evidence_origins_and_business_feed.sql
e03567ebed710a79a398e87eeb4d4a94457aad32cd976a19c52224836b75a980  20260826151000_disable_netlify_blocked_nj_business_feed.sql
18703933896e323303ba80387d4ea44fa9976583bfd906a0738d048964732a99  20260826175800_expand_reviewed_nj_journalism_sources.sql
223944425b49eaaba61f4190442d5f9001d2936be7568f13c21000c3dc5e0896  20260826190000_add_safe_story_reconciliation.sql
f59411f2cfa282a265b1a50b28c001bc9bf432139b8b724fba1b9c9d832d8c2b  20260827161604_expand_reviewed_local_sources_and_reduce_polling.sql
2a1d9b4ae77722f3160f30db11d10df327d4e3b891bfafd5aecd98c19969cd51  20260827171634_expand_verified_sources_and_event_matching.sql
35fbfcc19a9f6ff0af39a9c9e76d1cbc84b951ca5027dc59031a07752cd89548  20260827183217_schedule_reath_edge_ingestion.sql
22e539587d3d2112887ae54afe44b178d1ba10c582eb7b4477e4c72f30224d57  20260827193340_manual_only_ingestion_maintenance.sql
9162d7ca88857166bdeb01e3ebb50788dc7e3abf3e1d755e6c474962905ed95b  20260827195634_enforce_manual_ingestion_admission.sql
02da3accc40a46290d396586f1d376492914450abbc4d2649fd6f1462a4f5d25  20260827195857_enforce_manual_refresh_and_retention.sql
```

During this recovery, no migration was renumbered, synthesized, applied, or sent to Supabase. The canonical history is represented as the canonical Git sequence plus the authoritative source candidate sequence; live one-to-one application is not claimed.

## Excluded categories and files

- All dirty-source `Archive/**` changes, including 97 untracked artwork files in the source checkout. The 270 `Archive/**` files already present in canonical `main` remain byte-for-byte unchanged and `publicDir: "public-reath"` keeps them out of the Reath build.
- All dirty generated `public/exports/**` files.
- The dirty-source/generated contents of `src/generated/repo-import-manifest.json` and all other generated repository-import output. Removing canonical main's tracked generated manifest is an included cutover change documented above; none of its content was transplanted.
- Actual `.env` files, credentials, private keys, tokens, and secrets.
- `.netlify/**`, `supabase/.temp/**`, Supabase link state, and machine-local CLI state.
- Backups, `dist/**`, dependency directories, caches, logs, and disposable artifacts.
- Unrelated dirty-source changes to `docs/OPERATIONS_API.md`, Creative OS functions/helpers, setup/import scripts and tests, `src/layouts/AppLayout.astro`, and `src/scripts/account-client.js`. Among otherwise unrelated Creative OS implementation files, only the three dependency-closure mixed files documented above were changed from their canonical versions.
- Dirty-source replacements for the eight canonical migration files.
- The dirty-source replacement of `netlify/functions/lib/runtime-contract.mjs`; the newer canonical implementation remains authoritative apart from the single documented project-authorization guard.

## Correction, retraction, and provenance disposition

The recovered implementation preserves linked Source Items and Story attachments as evidence and uses append-only editorial decisions for merges, detaches, and state changes. Corrections to clustering are represented by audited detach/split/merge actions and the two dated calibration migrations; detached evidence is not automatically reattached. An editor can detach affected evidence with a reason while retaining historical provenance, but the source does not define first-class publisher correction or retraction state. Complete publisher-correction/retraction handling is therefore not claimed and was not invented during recovery. The separate unlinked-item retention limit is documented below.

## Known uncertainties and limitations

1. `20260720123053_add_authenticated_comment_resonance_votes.sql` depends on a historical `public.comments` table whose creation is absent from migration history. A full clean replay of all twenty-four filenames is therefore not claimed. The Reath database check starts at the conversion boundary and validates the resulting Reath schema.
2. The historical schedule migration contains production Edge-function URL text before the following migration disables the schedule. This recovery must not use `supabase db reset` or any linked CLI command. Validation is embedded/offline only.
3. `supabase/config.toml` enables `supabase/seed.sql`, but that seed file does not exist in the authoritative source.
4. Canonical authority documentation records migrations 7–8 as applied, but this recovery did not independently reverify production history because production access was prohibited. Remote application of the sixteen Reath candidate migrations remains unknown.
5. The recovered authoritative implementation is manual-only. That is suitable for the approved initial calibration path but does not implement the later mature target of one bounded approximately thirty-minute scheduler with manual fallback.
6. Its final migration deletes some unlinked pending/error/ignored Source Items older than thirty days and ignores newly encountered evidence older than that cutoff. This conflicts with the later approved policy treating thirty days as attention rather than retention.
7. Its above-low signal gate requires either two independent reviewed journalism groups or three reputable groups, including at least one journalism group; the latter may include official or institutional-primary evidence. That conflicts with the later approved explicit evidence-state model and the instruction not to universally suppress credible single-source or primary-source local Stories.
8. The local Astro preview serves the static Wire shell only; it does not emulate Netlify Functions, Netlify Identity, or Supabase. Runtime and fixture behavior is established by the offline test suite, while the preview establishes rendering, asset boundaries, and the unauthenticated authority boundary. Live fixture rendering and editor correction actions are not browser-verified.
9. Gitleaks is unavailable. An ad-hoc high-confidence regex scan covered private-key headers and common GitHub, OpenAI, Supabase, Netlify, AWS, JWT, npm, Slack, Google, SendGrid, Stripe, and credential-URI signatures across the tracked tree, feature-branch patches, ignored environment files, and built output; it found zero hits. This is not a committed/reproducible scanner or a substitute for a Gitleaks check before merge.

The recovery preserves these V1 behaviors faithfully so future workers can review and advance them; it must not be described as the final eight-PR production-policy implementation.

## Validation record

All commands ran from the recovery worktree with Supabase database/service credentials and AI-provider credentials explicitly absent. No linked Supabase CLI, Netlify deploy, production database, or AI provider was contacted.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile policy passed, 450 packages installed from the pnpm store with pnpm 11.19.0 in 2m 56.7s; lockfile unchanged. |
| `pnpm lint` | PASS. |
| `pnpm typecheck` | PASS; Astro checked 116 files with 0 errors, 0 warnings, and 0 hints. Astro separately logged that three empty content collections had no JSON files. |
| `pnpm test` | PASS on final run: 247/247 tests in 6.77s. The first run failed 5 loader suites because the excluded generated manifest still had canonical static imports; the documented inert-catalog/test dependency closure removed those imports, after which the complete suite passed. |
| `pnpm test:reath` | PASS: 118/118 tests in 7.06s. |
| `pnpm db:check` | PASS offline: static checks found 20 tables, 564 municipalities, and 78 assessed Sources; embedded Postgres executed 20 tables and 41 functions with RLS/ACL checks intact. Live check explicitly skipped because server-only Supabase environment was absent. |
| `pnpm edge:check` | PASS; 10 shared Reath runtime modules verified. |
| `pnpm build` | PASS; Astro diagnostics 0/0/0 and four static pages built: `/`, `/wire/`, `/wire/health/`, and `/wire/ai/`. |
| `pnpm preview --host 127.0.0.1 --port 4321` | PASS; served `http://127.0.0.1:4321/`. Browser inspection of `/wire/` rendered the invitation-only desk, manual ingestion control, provenance language, and human-editorial boundary with no console errors. The only console entry was GoTrue's expected HTTP-on-localhost warning. |
| Supplemental mixed-file ESLint | PASS for `scripts/operations-api.test.mjs`, `scripts/supabase-api.test.mjs`, and `src/server/creative-os/handle-creative-os.mjs`. |
| `git diff --check` | PASS. |

Tree and build scans found no credential signatures, actual `.env` files, dirty-source Archive delta, generated public exports, repository-import manifest, `.netlify` state, `supabase/.temp` state, or forbidden project ref in browser output. The eight canonical migrations match canonical Git blobs and all sixteen appended Reath migration SHA-256 values match the read-only source.

### Local preview

```powershell
cd "C:\Users\gjoep\OneDrive\Desktop\Reath Digest Backend Recovery"
pnpm install --frozen-lockfile
pnpm build
pnpm preview --host 127.0.0.1 --port 4321
```

Open `http://127.0.0.1:4321/wire/`. This is the static, unauthenticated shell. Netlify Functions, Identity, Supabase-backed Stories, and editor mutations require an appropriate local Netlify/backend environment and were intentionally not connected during recovery.

## Reviewable commit stages

1. `964ea23e0e743778c2cea2d6c1432e6a004caa45` — `chore: establish Reath recovery boundary`
2. `7b320cde7ef796cdc232bdd40d830b07bfc76a25` — `feat: recover Reath ingestion runtime and Wire`
3. `test: add Reath recovery verification` — fixtures, complete tests, dependency-closure assertions, final validation record, and this manifest. Once committed, it is the recovery branch HEAD; its full SHA is reported externally because a commit cannot embed its own identity.

## Hash notes

Pure-copy Reath files are copied byte-for-byte and their source/result SHA-256 values are equal, except `docs/reath-news-ingester.md`, where two Markdown trailing-space hard breaks were normalized to satisfy `git diff --check`. Mixed files intentionally differ from canonical; some equal the source while others reconcile both parents, as documented hunk-by-hunk above. Git blob IDs are authoritative for canonical baseline migrations; the displayed SHA-256 values normalize line endings to LF so Windows checkout conversion does not create a false mismatch.
