# Creative OS runtime authority

Status: canonical runtime active in production; Step 4B compatibility retirement staged for review
Decision date: 2026-08-07
Schema contract version: `1`

## Authority decision

The only canonical production authority for Creative OS is the Supabase project:

- Name: `creative os`
- Project ref: `okqkljexfzolzxysjaha`
- Runtime mutation authority: `creative-os-api`

New routine Creative OS writes may target only that project in the `production` runtime context and may pass only through the authoritative Creative OS API. A URL/project-ref mismatch, missing declaration, incompatible schema contract, missing required table or column, or missing/private-bucket violation must fail closed before authentication bridging, profile upsert, audit creation, or any application mutation.

The Supabase project `creative-systems-eggs` (`uzderzjbitmghfvrllvz`) is a read-only legacy evidence source. It contains legacy-only Creative OS evidence and unrelated poker/recap/stat data. It is not an alternate production authority and must not receive the Step 2 migration.

## Backup gate

The backup gate completed on 2026-08-07 before this contract was introduced. Verified logical database dumps, complete Storage object exports, live inventories, runtime evidence, and SHA-256 manifests for both projects are stored outside the source tree at:

`C:\Users\gjoep\Creative Systems Backups\creative-os-backup-gate-20260807`

No backup artifact belongs in Git.

## Netlify production identity

- Site: `eggs-creative-systems-os`
- Site ID: `f69df1d9-50ff-4b8c-a3e8-0ae266a946aa`
- Audited current deploy ID before Step 4B source changes: `6a769cf7e8abd400085a825d`
- Deploy source repository: `simply0307/Creative-Systems1`
- Deploy branch: `main`
- Deploy commit: `508091e5d7494132bf629ba05f9713c6781bb6ed`
- Deployed functions: `creative-os`, `operations`

The production-context Netlify environment now declares the canonical project ref, runtime context, schema-contract version, mutation authority, and five bucket names. Deploy-preview and branch-deploy contexts declare the contract metadata and bucket names but intentionally have no `SUPABASE_PROJECT_REF`; they therefore fail closed until a separate non-production backend is explicitly assigned. Existing URL and credential values were not changed.

The authoritative maintained application source is `simply0307/Creative-Systems1` on `main`. The reviewed Step 2B deployment candidate is based on `b5ff10525ef48099090e6cdd143497065e5c47fb`, the current remote `main` tip at the decision time. Netlify is already attached to this repository and branch.

The previous development source, `simply0307/creative-systems.git` on local `master` at `4b985bb15049d074d3c73d4367c26f844f1c92a2`, and `Creative-Systems1` have no shared Git commits or merge base. They are independently initialized repositories containing substantially matching application trees. The former remote was not accessible during Step 2B. It remains preservation evidence and must not be deleted or archived until its current tracked-only material and uncommitted user archive files receive a separate provenance review.

The reconciliation preserves the newer `Creative-Systems1` production history and its `main`-branch operations fixtures, imports the Step 2 runtime contract and canonical migration evidence, and adds the tracked archive governance/index sources that existed only in the previous development repository. It intentionally excludes local untracked archive artwork, `desktop.ini`, deployment-card images, the large Word template, backup artifacts, and the tracked Supabase CLI `.temp` marker. Those exclusions prevent unreviewed or machine-local material from entering a production candidate; they do not delete the originals.

The version-1 runtime and fail-closed Identity authorization are active in production. At the Step 4B pre-change audit, `/`, health, and readiness returned HTTP 200; readiness identified canonical project `okqkljexfzolzxysjaha`, contract version `1`, authority `creative-os-api`, compatible schema, and all five private buckets. The legacy `operations` function was still deployed and returned its historical diagnostics; this branch changes it to a non-mutating 410 tombstone but does not deploy that change.

## Migration history and drift

Canonical Supabase records these migrations:

1. `20260715140231_creative_os`
2. `20260715140306_artifact_organization_phase1`
3. `20260715140315_controlled_values_management`
4. `20260715140324_archive_index_folder_tags`
5. `20260720123053_add_authenticated_comment_resonance_votes`
6. `20260807101623_establish_runtime_contract`
7. `20260807224000_harden_direct_function_privileges`
8. `20260810032000_worker_budget_rpc`

The first four local SQL bodies were proven identical to the corresponding remote stored statements after newline normalization. Their repository filenames had older version prefixes, so the files were renamed to the versions actually recorded by canonical Supabase without changing their SQL bodies.

The fifth migration was absent from both the Step 2 checkout and the exact Netlify deploy source. Its SQL was reconstructed exactly from `supabase_migrations.schema_migrations.statements` and preserved under the recorded remote version and name.

Known unresolved historical gap: `public.comments` existed before the fifth migration, but its creation is not represented in canonical migration history or the audited repositories. The fifth migration depends on that table. Do not claim that a clean database can replay the full history until an evidence-based baseline strategy is separately reviewed. The new runtime-contract migration is forward-only and does not fabricate or rewrite the missing comments-table history.

The sixth migration was applied only to canonical `creative os` on 2026-08-07 after an isolated CLI history comparison, a one-migration dry run, and a transactional apply/assert/rollback test. The seventh hardened browser-role function execution. The eighth added the reviewed Worker-budget RPCs. Live readiness passes all required table/column and private-bucket probes. The legacy project was not changed.

The eighth migration's SQL was initially recorded by an API migration tool under accidental version `20260810143101`. On 2026-08-10, exact stored-SQL, function-definition, signature, ACL, data, Storage, and recovery-checkpoint verification proved that only migration history was wrong. The official Supabase CLI marked `20260810143101` reverted and repository version `20260810032000` applied without rerunning SQL. Canonical and legacy fingerprints were unchanged. Normal production migrations now follow [`docs/PRODUCTION_MIGRATIONS.md`](PRODUCTION_MIGRATIONS.md): the repository filename is authoritative, a serialized GitHub Actions gate dry-runs the exact approved versions, and its sole database write is `supabase db push`.

## Runtime environment contract

Every server runtime must explicitly declare:

- `CREATIVE_OS_RUNTIME_CONTEXT`
- `CREATIVE_OS_SCHEMA_CONTRACT_VERSION=1`
- `CREATIVE_OS_MUTATION_AUTHORITY=creative-os-api`
- `SUPABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ANON_KEY` or supported publishable equivalent
- `SUPABASE_SERVICE_ROLE_KEY` or supported server secret equivalent
- all five `SUPABASE_STORAGE_BUCKET_*` names

Expected contexts:

| Context | Project rule |
|---|---|
| `production` | Must declare `okqkljexfzolzxysjaha`. |
| `deploy-preview` | Must explicitly declare a non-production project. Missing declaration fails closed. |
| `branch-deploy` | Must explicitly declare a non-production project. Missing declaration fails closed. |
| `dev-server` | Must explicitly declare its project; canonical use requires an explicit override. |
| `local` | Must explicitly declare its project; canonical use requires an explicit override. |
| `test` | Must use explicit test configuration or mocks; canonical use requires an explicit override. |

`CREATIVE_OS_ALLOW_CANONICAL_NON_PRODUCTION=true` is the deliberate override for exceptional local/non-production access to canonical authority. It must never be an inherited default.

The runtime derives the project ref from the standard HTTPS Supabase URL and compares it with `SUPABASE_PROJECT_REF`. Version 1 does not accept a custom domain or a local URL that cannot prove the represented project identity.

## Database runtime contract

Migration `20260807101623_establish_runtime_contract.sql` creates the RLS-enabled singleton table `public.creative_os_runtime_contract`. Only the server role is granted read access. The version 1 row records:

- contract ID `creative-os`
- schema contract version `1`
- mutation authority `creative-os-api`
- canonical production project ref `okqkljexfzolzxysjaha`
- the five required private Storage buckets
- creation metadata and timestamps

After the reviewed application of `20260810032000_worker_budget_rpc.sql`, readiness calls one read-only, service-role-only RPC that checks the contract row and every required table/column. The database contract row alone is not sufficient. Repository and canonical migration histories now identify that migration by the same version.

## Required private Storage buckets

- `artifacts`
- `exports`
- `imports-raw`
- `imports-processed`
- `thumbnails`

All five must exist and have `public = false`.

## Health and readiness

- `GET /api/creative-os/health` is shallow and does not contact or mutate Supabase. It reports process/configuration presence and non-secret contract expectations.
- `GET /api/creative-os/ready` is read-only and always forces a fresh contract/schema/Storage check. `GET /api/creative-os/health/full` is a compatibility alias with the same deep behavior.
- The former mutating health audit probe is removed.
- Every non-health Creative OS request must pass readiness before identity resolution, profile bridging, audit writes, Storage writes, or application-table mutations. Successful results may be reused within one isolate for at most 30 seconds; failures are never cached.

Health and readiness responses expose no credential values.

## Step 4B retirement boundary

Routine production mutation authority remains `/api/creative-os/*`. The Step 4B branch retains the `/api/operations` redirect and function for one compatibility release, but replaces the implementation with a dependency-free 410 tombstone. The repository snapshot is read-only during page initialization; import requires a confirmed admin/owner action. Direct maintenance writers require apply intent, an exact project-ref confirmation, readiness, and an additional canonical/production confirmation. Repository-derived export review files are generated outside public deployment and are distinct from canonical private exports.

This is a source candidate only. Do not claim the tombstone or export removal is active until a later authorized Git merge and normal Netlify deployment passes the acceptance checklist in `docs/OPERATIONS_API.md`.
