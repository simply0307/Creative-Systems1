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

## Included files

The following files are the complete content-transplant set. Paths not listed here were not transferred from the dirty source.

### Reconciled configuration and authority files

- `.env.example`
- `AGENTS.md`
- `astro.config.mjs`
- `docs/RUNTIME_AUTHORITY.md`
- `docs/recovery/reath-digest-transplant-manifest.md`
- `netlify.toml`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/pages/index.astro`
- `src/pages/pipeline/artifacts.astro` (removed as part of the Reath cutover)
- `src/pages/pipeline/index.astro` (removed as part of the Reath cutover)

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

The Reath runtime reuses canonical `netlify/functions/lib/runtime-contract.mjs` without importing the older dirty-source version. Reath uses only its exported canonical project constant and URL parser.

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

### Additive Reath migrations

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
| `netlify.toml` | Selected the Reath function-wrapper directory and AI-off Reath contexts; removed redirects to functions that are not in that selected deployment directory. No schedule was added. |
| `package.json` | Kept canonical baseline/security/migration scripts; added Reath lint, typecheck, test, database, edge-sync, and reconciliation scripts plus their pinned dependencies. Reath build no longer generates excluded Archive exports/manifests. |
| `pnpm-lock.yaml` | Took the authoritative Reath dependency closure; frozen-lockfile verification must pass. |
| `pnpm-workspace.yaml` | Kept canonical build allowlists; added the source's hoisted linker and explicit ESLint release-age exception needed by the locked dependency graph. |
| `src/pages/index.astro` | Replaced the Archive landing page with the source Reath landing page. |
| `src/pages/pipeline/artifacts.astro` | Removed to prevent the retired Archive pipeline from remaining reachable in the Reath build. |
| `src/pages/pipeline/index.astro` | Removed to prevent the retired Archive pipeline from remaining reachable in the Reath build. |

Canonical Creative OS implementation files deliberately left unchanged include `docs/OPERATIONS_API.md`, `netlify/functions/creative-os.mjs`, `netlify/functions/lib/supabase.mjs`, `netlify/functions/lib/runtime-contract.mjs`, the setup/import scripts and tests, `src/layouts/AppLayout.astro`, and `src/scripts/account-client.js`.

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

The source duplicates of the last two have an extra semicolon or blank-line drift and were not copied. The sixteen additive Reath files retain these raw source/result SHA-256 values:

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

No migration was renumbered, synthesized, applied, or sent to Supabase. The canonical history is represented as the canonical Git sequence plus the authoritative source candidate sequence; live one-to-one application is not claimed.

## Excluded categories and files

- All `Archive/**` content, including 97 untracked artwork files in the source checkout.
- All dirty generated `public/exports/**` files.
- `src/generated/repo-import-manifest.json` and other generated repository-import output.
- Actual `.env` files, credentials, private keys, tokens, and secrets.
- `.netlify/**`, `supabase/.temp/**`, Supabase link state, and machine-local CLI state.
- Backups, `dist/**`, dependency directories, caches, logs, and disposable artifacts.
- Unrelated source changes to `docs/OPERATIONS_API.md`, Creative OS functions/helpers, setup/import scripts and tests, `src/layouts/AppLayout.astro`, and `src/scripts/account-client.js`.
- Dirty-source replacements for the eight canonical migration files.
- Dirty-source `netlify/functions/lib/runtime-contract.mjs`; the newer canonical file remains authoritative.

## Correction, retraction, and provenance disposition

The recovered implementation preserves Source Items and Story attachments as evidence and uses append-only editorial decisions for merges, detaches, and state changes. Corrections to clustering are represented by audited detach/split/merge actions and the two dated calibration migrations; detached evidence is not automatically reattached. A publisher retraction can therefore be recorded by detaching the affected evidence with an editorial reason while retaining its historical provenance. The source does not define a separate universal publisher-retraction object, so that is a known model limit rather than an invented recovery feature.

## Known uncertainties and limitations

1. `20260720123053_add_authenticated_comment_resonance_votes.sql` depends on a historical `public.comments` table whose creation is absent from migration history. A full clean replay of all twenty-four filenames is therefore not claimed. The Reath database check starts at the conversion boundary and validates the resulting Reath schema.
2. The historical schedule migration contains production Edge-function URL text before the following migration disables the schedule. This recovery must not use `supabase db reset` or any linked CLI command. Validation is embedded/offline only.
3. `supabase/config.toml` enables `supabase/seed.sql`, but that seed file does not exist in the authoritative source.
4. With production access prohibited, no offline evidence proves which of canonical migrations 7–8 or the sixteen Reath candidates are applied remotely.
5. The recovered authoritative implementation is manual-only. Its final migration deletes some unlinked pending/error/ignored Source Items older than thirty days and ignores newly encountered evidence older than that cutoff. This conflicts with the later approved policy treating thirty days as attention rather than retention. The recovery preserves the source evidence exactly and must not be described as the final production-policy implementation.
6. The local Astro preview serves the static Wire shell only; it does not emulate Netlify Functions, Netlify Identity, or Supabase. Runtime and fixture behavior must be established by the offline test suite, while the preview establishes rendering, asset boundaries, and absence of browser/runtime errors in the unauthenticated shell.
7. Gitleaks was unavailable during the initial inventory. Repository-wide credential-pattern scans must still pass before push.

## Hash notes

Pure-copy Reath files are copied byte-for-byte; source and result SHA-256 values are equal. Mixed-file hashes are recorded after final validation because their output intentionally differs from both parents. Git blob IDs are authoritative for canonical baseline migrations; the displayed SHA-256 values normalize line endings to LF so Windows checkout conversion does not create a false mismatch.
