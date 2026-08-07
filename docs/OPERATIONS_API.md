# Creative OS Archive Index setup

This is the step-by-step deployment guide for the solo-user Creative OS Archive Index. The live app is intentionally simple and focused on archive, index, tag, import, export, preview, and download operations.

## Current implementation

The app currently runs in solo archive mode. There are no accounts, employee roles, or Admin Portal requirements in the active product surface.

Current behavior in this branch:

- Every browser session is treated as the single `Archive operator`.
- Folder moves, standardized tags, freeform tags, title, and note edits apply directly to Supabase and create audit events.
- Folder paths become virtual categories.
- Folder names/segments become standardized `folder` tags.
- Non-folder controlled tags use the `standard` tag type.
- Casual human tags use the `freeform` tag type.
- Review queues, account roles, admin approval workflows, and multi-user permissions are deferred.
- `/pipeline/artifacts` is the main working surface.
- `npm run repo:manifest` scans the local `Archive/` folder and writes `src/generated/repo-import-manifest.json`.
- The generated manifest includes both the old curated artifact metadata and the full Archive folder file list.
- In the live app, the Archive page automatically syncs the GitHub/Netlify Archive snapshot into Supabase when it loads.
- Files remain marked `needs_import` until the actual file is uploaded/attached through the browser.

This does not publish raw archive files automatically. GitHub/Netlify provide the folder snapshot; Supabase stores live metadata and private file copies. Real previews/downloads appear only after files are uploaded into Supabase Storage.

The current Supabase project for this redux is:

```text
SUPABASE_URL=https://okqkljexfzolzxysjaha.supabase.co
SUPABASE_PROJECT_REF=okqkljexfzolzxysjaha
```

Do these sections in order. Do not upload archive files until the migration and metadata seed have completed successfully.

## Before you begin

You need:

- Access to the Creative Systems repository on this computer.
- Access to the Netlify project that hosts Creative OS.
- A Supabase account and permission to create a project.
- No Netlify Identity setup is required for the current solo-user app.

Run all terminal commands from the repository root:

```text
C:\Users\gjoep\OneDrive\Desktop\Creative Systems
```

Never commit `.env`. Never paste a Supabase secret/service-role key into browser code, a `PUBLIC_` environment variable, screenshots, chat, or GitHub.

## Fast automated setup

The setup commands automate everything that can be safely automated without creating accounts or guessing production credentials.

### Manual prerequisites

Do these once before running the guided command:

1. Create the Supabase project in the Dashboard.
2. Copy the Project URL, publishable/anon key, secret/service-role key, and project reference.
3. Confirm the repository is linked to the correct Netlify site, or copy its site ID.
4. Skip account setup for now. This app is intentionally running as a single-user archive tool.
5. Copy `.env.example` to `.env` and enter the copied values. Never commit `.env`.

The project reference is the value in the Dashboard URL after `/project/` and is also the subdomain in `https://PROJECT_REF.supabase.co`.

### Install the optional CLIs

Node.js 20 or newer is required. Install repository-local CLIs so everyone uses the same command style:

```powershell
npm install --save-dev supabase netlify-cli
```

Supabase does not support `npm install -g supabase`. On Windows, Scoop is the supported global alternative:

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

Authenticate/link each CLI if needed:

```powershell
npx supabase login
npx netlify login
npx netlify link
```

### Guided command

Run:

```powershell
npm run setup
```

The guided command runs, in order:

1. `setup:check` — validates Node/npm, both CLIs, `.env`, required variable names, migration/import files, and Netlify linkage. It never prints credential values.
2. `setup:supabase` — links the project, dry-checks and pushes pending migrations, verifies all required tables, creates or secures all five buckets, and inserts or updates one setup audit event.
3. `setup:netlify` — copies the explicit runtime identity, project, credential, and bucket variables only to the selected Netlify context. It hides values and does not deploy by default.
4. `setup:import` — runs metadata and file dry runs and prints counts. It does not write records or upload files.

The wrapper then stops. It never starts the real import automatically.

### Individual commands

```powershell
npm run setup:check
npm run setup:supabase
npm run setup:netlify -- --context=production
npm run setup:import
npm run setup:import:apply
npm run setup:verify -- --url=https://YOUR-SITE.netlify.app
```

- `setup:import:apply` displays the planned effect and requires you to type `IMPORT`. Non-interactive use requires the explicit `--confirm-import` flag.
- `setup:netlify` requires `--context=production`, `--context=deploy-preview`, or `--context=branch-deploy`; it never flattens values across contexts. A deploy remains separately authorized.
- `setup:verify` performs read-only project-identity, runtime-contract, required-table/column, private-bucket, credential, health, and readiness checks.

### Safe migration fallback

If the Supabase CLI is unavailable or cannot authenticate, stop. Install/authenticate it, compare `supabase migration list --linked` with `docs/RUNTIME_AUTHORITY.md`, and review `supabase db push --dry-run`. Do not paste a partial historical migration into the SQL Editor: canonical migration history contains documented drift.

The setup scripts never call `supabase db reset`, drop the production database, or delete tables. Existing tables/buckets continue safely. File imports use content checksums and immutable Storage paths: unchanged files are skipped, changed files receive a new object path, and an old Storage object is not overwritten.

## Part 1 — Create the Supabase project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and sign in.
2. Choose your organization, then select **New project**.
3. Enter a recognizable project name, such as `creative-os-production`.
4. Generate a strong database password and save it in your password manager. The app does not use this password directly, but you will need it for database administration.
5. Choose the region nearest the employees who will use Creative OS.
6. Select **Create new project**.
7. Wait until the project says it is ready before continuing.

## Part 2 — Copy the URL and API keys

Supabase now recommends publishable and secret keys. Older projects may instead show legacy `anon` and `service_role` keys. Creative OS supports either naming generation:

| Creative OS variable | Preferred current Supabase value | Legacy equivalent |
|---|---|---|
| `SUPABASE_URL` | Project URL | Project URL |
| `SUPABASE_ANON_KEY` | Publishable key beginning `sb_publishable_` | `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key beginning `sb_secret_` | `service_role` key |

To find them:

1. Open your Supabase project.
2. Use the project’s **Connect** button for the Project URL and recommended keys, or open **Settings → API Keys** to see every key.
3. Copy the **Project URL**, which looks like `https://abcdefgh.supabase.co`. This is `SUPABASE_URL`.
4. Copy the **Publishable key**. This is `SUPABASE_ANON_KEY`. If your project only shows legacy keys, copy `anon` instead.
5. Create/copy a backend **Secret key**. This is `SUPABASE_SERVICE_ROLE_KEY`. If using legacy keys, copy `service_role` instead.
6. Keep the secret/service-role value private. It bypasses Row Level Security and belongs only in local `.env`, protected Netlify environment variables, and trusted import scripts.

The browser receives only the publishable/anon key when completing a server-authorized signed upload. The secret/service-role key stays inside Netlify Functions.

Official references: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [creating Storage buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets).

## Part 3 — Configure local `.env`

1. In PowerShell at the repository root, create your private environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

2. Replace every placeholder with the values copied from Supabase:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_LEGACY_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_OR_LEGACY_SERVICE_ROLE_KEY
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_STORAGE_BUCKET_ARTIFACTS=artifacts
SUPABASE_STORAGE_BUCKET_EXPORTS=exports
NETLIFY_SITE_ID=YOUR_NETLIFY_SITE_ID
CREATIVE_OS_SITE_URL=https://YOUR-SITE.netlify.app
```

3. Save `.env`.
4. Do not add quotation marks unless the value itself contains them.
5. Confirm Git ignores the file:

```powershell
git status --short
```

`.env` must not appear in the output. `.env.example` is safe to commit because it contains no real keys.

## Part 4 — Apply reviewed migrations

The ordered migrations create the Postgres tables, indexes, triggers, Row Level Security settings, five private Storage buckets, and the Creative OS runtime contract.

1. Confirm the linked project ref is the intended target.
2. Compare local and remote history:

```powershell
npx supabase migration list --linked
```

3. Review the pending migration without applying it:

```powershell
npx supabase db push --dry-run
```

4. Apply only after the dry run names the reviewed forward migration.
5. Stop if any SQL or migration-history error appears; never use `db reset` against production.
6. Confirm these tables exist, including the contract singleton:

```text
profiles
artifacts
tags
artifact_tags
categories
artifact_categories
archive_records
artifact_archive_records
decisions
decision_resolutions
review_requests
review_notes
audit_events
import_batches
exports
creative_os_runtime_contract
```

### Storage buckets

The migration automatically creates these buckets and forces `public = false`:

```text
artifacts
exports
imports-raw
imports-processed
thumbnails
```

Verify them in Supabase Dashboard under **Storage**. Each bucket must be private. Do not enable **Public bucket**.

If a bucket is missing, create it manually:

1. Open **Storage**.
2. Select **New bucket**.
3. Enter the exact bucket name from the list above.
4. Leave **Public bucket** off.
5. Repeat until all five exist.

Alternatively, run this repair query in SQL Editor:

```sql
insert into storage.buckets (id, name, public)
values
  ('artifacts', 'artifacts', false),
  ('exports', 'exports', false),
  ('imports-raw', 'imports-raw', false),
  ('imports-processed', 'imports-processed', false),
  ('thumbnails', 'thumbnails', false)
on conflict (id) do update set public = false;
```

## Part 5 — Seed existing metadata

The seed imports repository artifact metadata, archive records, and remediation/decision records. It does not upload files or make anything public.

1. Preview the seed without writing:

```powershell
npm run supabase:seed:dry
```

2. Review the counts. The current repository should report approximately 16 artifacts, 22 archive records, and 81 remediation/decision records.
3. Run the real seed:

```powershell
npm run supabase:seed
```

4. Wait for `"imported": true`.
5. In Supabase **Table Editor**, open `artifacts` and confirm rows exist.

The seed marks workspace files as `internal_only`. That is intentional: metadata exists, but the file is not considered available until it has been copied into private Storage.

## Part 6 — Preview and run the workspace file import

The workspace importer scans `Archive/`, preserves the original files, uploads private copies, creates records for previously unindexed files, and creates an import-batch review request.

1. Run the dry run:

```powershell
npm run supabase:files:dry
```

2. Review the output before continuing. At the Step 2 audit point, the current repository reported 367 files: 351 images, 1 PDF, and 15 text files. Treat the live dry-run output as authoritative when the archive changes.
3. Run the real import:

```powershell
npm run supabase:files
```

4. Keep PowerShell open until it reports every file uploaded and prints a `batchId`.
5. In Supabase **Storage → artifacts**, confirm a `workspace/Archive/` tree exists.
6. In `artifacts`, confirm imported rows have:

```text
file_status = available
storage_bucket = artifacts
storage_path = workspace/Archive/...
visibility = internal
review_status = needs-review
```

The import does not move or rewrite source files. Unknown-rights material remains internal and review-required.

## Part 7 — Configure Netlify environment variables

1. Open the Creative OS project in Netlify.
2. Open **Project configuration → Environment variables**.
3. Add these variables one at a time using the same Supabase values from `.env`:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET_ARTIFACTS=artifacts
SUPABASE_STORAGE_BUCKET_EXPORTS=exports
```

4. Make them available to Functions. Use all deploy contexts unless you intentionally maintain separate preview/production Supabase projects.
5. Do not prefix any variable with `PUBLIC_`.
6. Save the variables.

### Redeploy Netlify

Environment changes do not update an already-running Function.

1. Open **Deploys** in Netlify.
2. Select **Trigger deploy**.
3. Select **Deploy site** or **Clear cache and deploy site**.
4. Wait for the deploy to finish successfully.
5. Open the newly published site rather than an old deploy preview tab.

If this code has not been pushed yet, commit and push the repository first. A Git-connected Netlify site will then build it automatically.

## Part 8 - Confirm solo archive mode

No account setup is required for the current app. Creative OS runs as a single archive operator so the working surface stays focused on archive, index, tag, import, export, preview, and download operations.

1. Open `/pipeline/artifacts` on the deployed Netlify site.
2. Confirm the left rail says **Solo archive mode**.
3. Confirm the page loads the Archive folder snapshot and shows file states.
4. Do not enable Netlify Identity for this version.

## Part 9 — Run health and readiness checks

Health and readiness are read-only and never expose key values.

1. Open:

```text
https://YOUR-SITE.netlify.app/api/creative-os/health
```

This shallow check confirms the Function is reachable and reports non-secret configuration presence. It does not contact Supabase.

2. Open the readiness endpoint:

```text
https://YOUR-SITE.netlify.app/api/creative-os/ready
```

3. Confirm readiness reports:

- URL-derived and declared project refs match
- Production project is `okqkljexfzolzxysjaha`
- Schema contract version is `1`
- Mutation authority is `creative-os-api`
- Every required table/column probe passes
- Storage buckets are 5/5 private
- Routine GitHub writes: disabled

The compatibility alias is:

```text
GET /api/creative-os/health/full
```

The former mutating audit probe has been removed. Neither endpoint upserts a profile, creates an audit event, nor writes a Storage probe.

## Private file behavior

- All five Storage buckets are private.
- Artifact listing runs through the deployed Netlify Function and Supabase.
- The current product assumes one trusted local archive operator.
- The server creates one-hour signed preview and download URLs. The browser never constructs permanent public URLs.
- Images display from signed preview URLs.
- PDFs receive signed Open and Download links.
- Text, Markdown, JSON, CSV, and similar safe text files can be read in the browser and downloaded.
- Office/doc-like files receive signed Open/Download links; inline rendering depends on browser support.
- Missing, metadata-only, external-only, internal-only, and archived records never receive a fake Storage URL.

## Browser add-file behavior

`/pipeline/artifacts` accepts added files from the browser. Use this for new files entering the Archive folder/web app, or to attach the actual file copy for a record that was already indexed from the Desktop Archive snapshot.

The flow is:

1. The Archive Index requests a scoped signed upload token.
2. The browser uploads directly to the private `artifacts` bucket.
3. The server verifies that the Storage path belongs to the current archive session.
4. The server creates the artifact row with filename, MIME type, size, Storage path, rights, canon, review, visibility, provenance, tags, and categories.
5. The server writes an audit event.
6. `/pipeline/artifacts` reads the new database row and requests signed preview/download URLs.

The app allows files up to 250 MB, but the Supabase project file-size limit may be lower.

### Existing archive folder sync

The deployed Archive page no longer requires a manual import button for the existing folder snapshot:

1. `npm run repo:manifest` scans the repository `Archive/` folder during build.
2. Netlify deploys that generated snapshot with the app.
3. `/pipeline/artifacts` compares the snapshot with Supabase on load.
4. Missing snapshot records are synced into Supabase automatically.
5. Individual files still need an uploaded/attached Storage copy before preview/download works in the browser.

File matching order is SHA-256 checksum, original relative path, filename plus size, filename, then slug. An available checksum/name-size match is skipped as a duplicate. An ambiguous match stops with diagnostics instead of creating a likely duplicate.

Each browser upload creates or updates Supabase rows and audit events. Manual import workflows are reserved for setup scripts and recovery, not day-to-day use.

## Database edit behavior

The active app assumes one trusted archive operator.

- Add tag: applied immediately to `artifact_tags` and audited.
- Remove tag: applied immediately and audited.
- Add/remove category or folder: applied immediately to the artifact relationships and audited.
- Title, notes, project, function, status, and rights fields save directly to Supabase.
- Refresh: reads the same persisted Supabase rows; no Netlify rebuild is required.

Review queues and multi-user approval are deferred until the archive/index workflow is proven useful.

## Artifact organization Phase 1

Run the newest migration before deploying this UI:

```powershell
npx supabase db push
```

The migration adds `project`, `intended_use`, and `notes`, widens the existing visibility values, and idempotently seeds the starter controlled tags. Existing `artifact_type` remains the medium field and `lifecycle_status` remains the workflow field. Categories and related archive records continue to use their existing join tables.

`/pipeline/artifacts` applies defaults for newly added files and supports medium, project, category, related archive record, function, rights, review, canon, visibility, workflow, controlled tags, freeform tags, and notes.

`/pipeline/artifacts` supports direct editing and bulk organization. Changes write immediately and create audit events in solo archive mode.

Reusable artifact filters are available through either API route form:

```text
GET /api/creative-os/artifacts?project=para-poker&rights_status=public-safe&review_status=approved
GET /.netlify/functions/creative-os?resource=artifacts&visibility=exportable&function=card-art
GET /api/creative-os/artifacts?entity=archive.zendra
GET /api/creative-os/artifacts?ready_for_export=true
```

Other supported parameters include `medium`, `artifact_type`, `workflow_status`, `category`, `controlled_tag`, `freeform_tag`, and `search`.

### Controlled values and filter mapping

Categories and tags reuse the existing `categories`, `tags`, `artifact_categories`, and `artifact_tags` tables. Category and tag selectors submit stable UUIDs; renaming a value therefore preserves every artifact relationship. The migration adds `is_active` instead of deleting historical values and adds case-insensitive unique indexes so `Reference`, `reference`, and `REFERENCE` cannot become separate categories or same-family tags.

Controlled values are managed from the Archive Index controls and setup data. Project, function, medium, rights, review, canon, visibility, and workflow dropdowns are populated from active controlled tag families. Renaming one of those values also updates matching artifact metadata rows safely.

Controlled dropdowns are used by artifact editing, add-file defaults, and bulk organization for:

- Medium / `artifact_type`
- Project / `project`
- Category relationship
- Function / `intended_use`
- Rights, review, canon, visibility, and workflow (`lifecycle_status`)
- Existing controlled and freeform tags through searchable multi-selects

Title, description, notes, reason/rationale, and provenance text remain freeform.

The browser and API share this alias map:

| UI/API alias | Database or relationship field |
| --- | --- |
| `medium`, `file_type` | `artifact_type` (image/PDF/text media is verified from MIME/filename) |
| `workflow`, `workflow_status` | `lifecycle_status` |
| `review_state` | `review_status` |
| `function` | `intended_use` |
| `category`, `category_id`, `category_slug` | `artifact_categories → categories` |
| `tag`, `tags`, `tag_slug` | `artifact_tags → tags` |
| `file_availability` | `file` / `file_status` |

Examples:

```text
GET /api/creative-os/artifacts?artifact_type=image
GET /api/creative-os/artifacts?artifact_type=pdf
GET /api/creative-os/artifacts?category=CATEGORY_UUID
GET /api/creative-os/artifacts?tag=TAG_UUID
GET /api/creative-os/artifacts?project=para-poker&rights_status=public-safe&review_status=approved
GET /.netlify/functions/creative-os?resource=artifacts&workflow=export-ready&visibility=exportable
```

Artifact Library keeps active filters in the page query string. Filters combine with AND semantics; **Clear filters** removes them and restores the complete loaded library.

## GitHub’s remaining role

Routine browser actions do not call `/api/operations`:

- Artifact tags and categories
- Browser uploads
- Review approvals/rejections
- File metadata changes
- Decision-resolution records
- Live exports

GitHub remains for code, SQL migrations, backup/snapshot tooling, releases, and optional generated/static exports. `OPERATIONS_ADMIN_KEY` is retained only for explicitly invoked legacy snapshot/versioning work.

## Final live acceptance checklist

- [ ] A. Supabase project created
- [ ] B. Migration ran successfully
- [ ] C. All five buckets exist and are private
- [ ] D. Local `.env` configured and ignored by Git
- [ ] E. Netlify environment variables configured
- [ ] F. `npm run supabase:seed` completed
- [ ] G. `npm run supabase:files:dry` reviewed
- [ ] H. `npm run supabase:files` completed
- [ ] I. Netlify redeployed
- [ ] J. Solo archive mode shows the `owner` role
- [ ] K. Artifact Library shows imported files
- [ ] L. Uploaded image shows a thumbnail and download link
- [ ] M. Uploaded PDF opens and downloads
- [ ] N. Owner tag persists after refresh
- [ ] O. Individual file download works from the Artifact Library
- [ ] P. Folder/category/tag edits remain after refresh
- [ ] Q. Database export generates and downloads

## Exact acceptance test

1. Open the deployed Archive Index as the solo archive operator.
2. Confirm shallow health is reachable and readiness is green without creating a profile, audit event, or Storage object.
3. Open `/pipeline/artifacts`; confirm imported images, PDFs, and text records show truthful file states.
4. Add one PNG or WebP from `/pipeline/artifacts`; confirm its thumbnail and download link.
5. Upload one PDF. Confirm Open and Download work.
6. Add tag `owner-live-test` to an artifact. Refresh the browser; confirm the tag remains under Live tags.
7. Move one artifact into a folder/category. Refresh and confirm the folder/category remains saved.
8. Download one individual file from the Artifact Library.
9. Create an Artifact Index export at `/pipeline/exports` and download it.
10. Confirm no routine Creative OS pull request was created in GitHub.

## Troubleshooting

- **Setup says Supabase CLI missing:** run `npm install --save-dev supabase`; do not install Supabase globally with npm. Stop rather than applying a partial migration manually.
- **Setup says Netlify CLI missing:** run `npm install --save-dev netlify-cli`, then `npx netlify login` and `npx netlify link`.
- **Supabase link asks for credentials:** complete `npx supabase login`. The database password may be requested when linking; retrieve it from your password manager or reset it in Supabase.
- **Migration dry run fails:** no migration was applied. Compare local/remote history with `docs/RUNTIME_AUTHORITY.md`. Never solve this with `db reset` against production.
- **Netlify site is not linked:** run `npx netlify link` or add `NETLIFY_SITE_ID` to `.env`.
- **Netlify variables changed but health remains red:** redeploy; existing Functions do not receive new environment values until a new deploy.
- **Real import immediately exits:** type exactly `IMPORT` at the prompt. This guard prevents an accidental file upload.
- **Rerunning import reports no changes:** this is expected. Matching artifact IDs/checksums, import batches, and Storage objects are skipped rather than duplicated.
- **Verification cannot reach localhost:8888:** start `netlify dev`, or pass the deployed URL with `npm run setup:verify -- --url=https://YOUR-SITE.netlify.app`.
- **Supabase URL/key says no:** verify the exact Netlify variable names, values, and deploy context, then redeploy.
- **Database connection fails:** confirm the migration completed and the secret/service-role key belongs to the same project as the URL.
- **Buckets missing:** rerun the bucket repair SQL or create them manually with Public bucket off.
- **401 or missing Function data:** test on the deployed Netlify site or through `netlify dev`; ordinary Astro preview does not run Netlify Functions.
- **Role does not show owner:** confirm the deployed code includes solo archive mode and redeploy Netlify.
- **Seed reports missing tables:** run the migration before the seed.
- **Imported records show Internal only:** run `npm run supabase:files`; metadata seeding alone does not upload files.
- **No photos after file import:** confirm `artifacts.file_status=available`, the bucket/path columns are populated, and Storage contains `workspace/Archive/...`.
- **Upload object exists but row does not:** inspect Netlify Function logs for `creative-os`. The completion endpoint attempts to remove a just-uploaded object when row creation fails.
- **Saved tag is not live after refresh:** check Function logs and Supabase audit events for the failed update.
- **Signed link expired:** refresh Artifact Library or Exports to obtain a new one-hour link.
- **Office document does not render inline:** use Download/Open in a compatible desktop or browser application.

## Static and migration fallback

- Repository Astro content remains a portable seed and static fallback.
- `scripts/generate-exports.mjs` still produces versioned build snapshots from repository content.
- `/pipeline/exports` produces current operational bundles from Supabase.
- Permanent database backups and scheduled GitHub snapshots remain future infrastructure work.
