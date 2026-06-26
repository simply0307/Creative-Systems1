# Creative OS live Supabase setup

This is the step-by-step deployment guide for the database-backed Creative OS. Normal uploads, tags, categories, metadata, reviews, decisions, audits, and live exports use Supabase. They do not create routine GitHub branches or pull requests.

Do these sections in order. Do not upload archive files until the migration and metadata seed have completed successfully.

## Before you begin

You need:

- Access to the Creative Systems repository on this computer.
- Access to the Netlify project that hosts Creative OS.
- A Supabase account and permission to create a project.
- A Netlify Identity account that can be assigned the `owner` role.

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
4. Assign your Netlify Identity account `{"roles":["owner"]}` when you are ready to test login.
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
3. `setup:netlify` — copies only the five required runtime variables to the linked Netlify site. It hides values and reminds you to redeploy.
4. `setup:import` — runs metadata and file dry runs and prints counts. It does not write records or upload files.

The wrapper then stops. It never starts the real import automatically.

### Individual commands

```powershell
npm run setup:check
npm run setup:supabase
npm run setup:netlify
npm run setup:import
npm run setup:import:apply
npm run setup:verify -- --url=https://YOUR-SITE.netlify.app
```

- `setup:import:apply` displays the planned effect and requires you to type `IMPORT`. Non-interactive use requires the explicit `--confirm-import` flag.
- `setup:netlify` sets variables but does not silently publish a dirty working tree. After inspecting the configuration, run `npm run setup:netlify -- --deploy` to build and deploy explicitly.
- `setup:verify` checks the live/public health route plus direct server-side database, anon-key, bucket, audit, and temporary signed-file probes. Its temporary Storage probe is removed immediately.
- CLI role verification is optional because the browser owns the Netlify Identity login session. Confirm the role in the Account panel after login. An ephemeral `NETLIFY_IDENTITY_TOKEN` can be supplied to the command environment when automated role verification is necessary; do not store a long-lived token.

### Safe migration fallback

If the Supabase CLI is unavailable or cannot authenticate, `setup:supabase` prints the exact migration path. Open **Supabase Dashboard → SQL Editor → New query**, copy all of `supabase/migrations/202606180001_creative_os.sql`, run it once, then rerun `npm run setup:supabase` to verify it.

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

## Part 4 — Run the SQL migration

The migration creates the Postgres tables, indexes, triggers, Row Level Security settings, and five private Storage buckets.

1. In Supabase Dashboard, open **SQL Editor**.
2. Select **New query**.
3. On this computer, open:

```text
supabase/migrations/202606180001_creative_os.sql
```

4. Copy the entire SQL file into the Supabase query editor.
5. Select **Run**.
6. Wait for a successful completion message. Stop here if any SQL error appears; do not run imports against a partial schema.
7. Open **Table Editor** and confirm these tables exist:

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

2. Review the output before continuing. The current repository reports approximately 181 files: 163 images, 3 PDFs, and 15 text files.
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

## Part 8 — Configure the owner account

Creative OS keeps Netlify Identity for employee login.

1. In Netlify, open **Project configuration → Identity** and enable Identity.
2. Set registration to **Invite only**.
3. Open **Identity → Users** and invite your employee email if it does not already exist.
4. Assign your account the trusted role `owner` so its token contains:

```json
{"roles":["owner"]}
```

5. Log out of Creative OS and log back in after changing the role. An old session token may still contain the previous role.

Supported roles are `viewer`, `contributor`, `editor`, `admin`, and `owner`. Authority comes from Netlify Identity `app_metadata.roles`; editing a Supabase profile row does not grant authority.

## Part 9 — Run the live setup health check

The health responses expose booleans and counts only—never key values.

1. Before login, open:

```text
https://YOUR-SITE.netlify.app/api/creative-os/health
```

This confirms the API route exists and reports whether the URL, publishable/anon key, and secret/service-role key are configured.

2. Log in to Creative OS.
3. Expand **Deployed version / setup health** in the Account panel.
4. Confirm:

- Supabase URL: yes
- Anon key: yes
- Service role: yes
- Database connection: yes
- Artifact read: yes, with a row count
- Storage buckets: 5/5 private
- Detected role: owner or admin
- Routine GitHub writes: disabled

5. As owner/admin, select **Run audit write probe** once. This intentionally creates one `health_check` audit event and proves audit inserts work.
6. The panel should change Audit write to **verified**.

The authenticated JSON equivalent is:

```text
GET /api/creative-os/health/full
```

The write probe is:

```text
POST /api/creative-os/health/audit-probe
```

The latter requires an authenticated `admin` or `owner`.

## Private file behavior

- All five Storage buckets are private.
- Artifact listing requires a Netlify Identity session.
- `private` artifacts are returned only to `admin` and `owner` roles.
- Other authenticated employees may read employee/internal artifacts according to the current visibility policy.
- The server creates one-hour signed preview and download URLs. The browser never constructs permanent public URLs.
- Images display from signed preview URLs.
- PDFs receive signed Open and Download links.
- Text, Markdown, JSON, CSV, and similar safe text files can be read in the browser and downloaded.
- Office/doc-like files receive signed Open/Download links; inline rendering depends on browser support.
- Missing, metadata-only, external-only, internal-only, and archived records never receive a fake Storage URL.

## Browser upload behavior

`/pipeline/import` accepts multiple files, including PNG, JPG/JPEG, WebP, PDF, text, Markdown, JSON, CSV, and common Office document extensions.

The flow is:

1. Authenticated contributor-or-higher requests a scoped signed upload token.
2. The browser uploads directly to the private `artifacts` bucket.
3. The server verifies that the Storage path belongs to that Identity user.
4. The server creates the artifact row with filename, MIME type, size, Storage path, rights, canon, review, visibility, provenance, tags, and categories.
5. The server writes an audit event.
6. Admin/owner uploads are immediately reviewed/live. Contributor/editor uploads create a review request.
7. `/pipeline/artifacts` reads the new database row and requests signed preview/download URLs.

The app allows files up to 250 MB, but the Supabase project’s configured Storage/file-size limit may be lower.

### Browser-first existing archive import

The deployed `/pipeline/import` page no longer requires local npm/CLI access for the initial content migration:

1. Log in as `admin` or `owner`.
2. Select **Import existing repo metadata**. The protected build manifest imports the 16 static artifact records, 22 archive records, 81 remediation/decision records, tags, categories, and known relationships.
3. Review the created/updated/skipped counts. Repeating the action is safe; existing IDs and relationship keys are reused, stored file links are preserved, and live rights/canon/review/visibility/decision states are not reset.
4. In the batch uploader, choose many files or choose the local `Archive` folder.
5. Set batch defaults and start the upload. Each file receives checksum/progress/status reporting and can be retried independently.

File matching order is SHA-256 checksum, original relative path, filename plus size, filename, then slug. An available checksum/name-size match is skipped as a duplicate. An ambiguous match stops with diagnostics instead of creating a likely duplicate.

Each browser batch creates an `import_batches` row, per-file status entries in its manifest, and audit events. Admin/owner results apply immediately. Contributor uploads create `review_requests` and remain review-marked until an admin/owner applies them.

## Database edit and review behavior

### Owner/admin

- Add tag: applied immediately to `artifact_tags` and audited.
- Remove tag: applied immediately and audited.
- Add/remove category: applied immediately to `artifact_categories` and audited.
- Refresh: reads the same persisted Supabase rows; no Netlify rebuild is required.

### Contributor

- Tag/category/metadata proposals create a `review_requests` row.
- Canonical tag/category joins remain unchanged until approval.
- Admin approval applies the proposed database change, then marks the request `applied`.
- Rejection marks the request `rejected` and does not mutate the artifact.

`/admin` reads `review_requests` and `audit_events` from Supabase. It does not read GitHub pull requests for routine review.

## Artifact organization Phase 1

Run the newest migration before deploying this UI:

```powershell
npx supabase db push
```

The migration adds `project`, `intended_use`, and `notes`, widens the existing visibility values, and idempotently seeds the starter controlled tags. Existing `artifact_type` remains the medium field and `lifecycle_status` remains the workflow field. Categories and related archive records continue to use their existing join tables.

`/pipeline/import` applies batch defaults for medium, project, category, related archive record, function, rights, review, canon, visibility, workflow, controlled tags, freeform tags, and notes. Images, PDFs, Markdown, text, and document-like files receive a medium automatically when **Detect from file** is selected.

`/pipeline/artifacts` supports direct editing and bulk organization. Admin/owner changes write immediately and create audit events. Contributor/editor controlled metadata changes create review requests. Low-risk editor freeform tags continue to follow the existing direct-apply policy.

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

Admin/owner users manage these values in **Admin Portal → Manage categories and tags**. They can create, rename, archive, or reactivate values and see their artifact usage counts. Project, function, medium, rights, review, canon, visibility, and workflow dropdowns are populated from active controlled tag families. Renaming one of those values also updates matching artifact metadata rows safely. Contributors do not receive controlled-value management authority; their artifact organization proposals continue through the review queue.

Controlled dropdowns are used by Import Center, artifact editing, and bulk organization for:

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
- [ ] J. Owner login shows the `owner` role
- [ ] K. Artifact Library shows imported files
- [ ] L. Uploaded image shows a thumbnail and download link
- [ ] M. Uploaded PDF opens and downloads
- [ ] N. Owner tag persists after refresh
- [ ] O. Contributor tag creates a pending review without changing live tags
- [ ] P. Admin approval makes the contributor tag live
- [ ] Q. Database export generates and downloads

## Exact acceptance test

1. Sign in as owner.
2. Expand Account setup health and confirm every check except Audit write is green/yes.
3. Run the audit write probe once.
4. Open `/pipeline/artifacts`; confirm imported images, PDFs, and text records show truthful file states.
5. Open `/pipeline/import`; upload one PNG or WebP. Return to Artifact Library and confirm its thumbnail.
6. Upload one PDF. Confirm Open and Download work.
7. Add tag `owner-live-test` to an artifact. Refresh the browser; confirm the tag remains under Live tags.
8. Log in as a contributor and add `contributor-review-test`. Confirm it appears as pending while Live tags remain unchanged.
9. Log back in as owner/admin, open `/admin`, and select **Approve & apply**.
10. Refresh the artifact and confirm `contributor-review-test` is live.
11. Create an Artifact Index export at `/pipeline/exports` and download it.
12. Confirm no routine Creative OS pull request was created in GitHub.

## Troubleshooting

- **Setup says Supabase CLI missing:** run `npm install --save-dev supabase`; do not install Supabase globally with npm. Alternatively, use the SQL Editor fallback printed by the command.
- **Setup says Netlify CLI missing:** run `npm install --save-dev netlify-cli`, then `npx netlify login` and `npx netlify link`.
- **Supabase link asks for credentials:** complete `npx supabase login`. The database password may be requested when linking; retrieve it from your password manager or reset it in Supabase.
- **Migration dry run fails:** no migration was applied. Read the CLI error, or use the SQL Editor fallback. Never solve this with `db reset` against production.
- **Netlify site is not linked:** run `npx netlify link` or add `NETLIFY_SITE_ID` to `.env`.
- **Netlify variables changed but health remains red:** redeploy; existing Functions do not receive new environment values until a new deploy.
- **Real import immediately exits:** type exactly `IMPORT` at the prompt. This guard prevents an accidental file upload.
- **Rerunning import reports no changes:** this is expected. Matching artifact IDs/checksums, import batches, and Storage objects are skipped rather than duplicated.
- **Verification cannot reach localhost:8888:** start `netlify dev`, or pass the deployed URL with `npm run setup:verify -- --url=https://YOUR-SITE.netlify.app`.
- **Supabase URL/key says no:** verify the exact Netlify variable names, values, and deploy context, then redeploy.
- **Database connection fails:** confirm the migration completed and the secret/service-role key belongs to the same project as the URL.
- **Buckets missing:** rerun the bucket repair SQL or create them manually with Public bucket off.
- **401/logged out:** test on the deployed Netlify site and log in again. Netlify Identity is not fully testable through ordinary Astro preview.
- **Role shows viewer:** assign trusted `app_metadata.roles`, then log out and back in.
- **Seed reports missing tables:** run the migration before the seed.
- **Imported records show Internal only:** run `npm run supabase:files`; metadata seeding alone does not upload files.
- **No photos after file import:** confirm `artifacts.file_status=available`, the bucket/path columns are populated, and Storage contains `workspace/Archive/...`.
- **Upload object exists but row does not:** inspect Netlify Function logs for `creative-os`. The completion endpoint attempts to remove a just-uploaded object when row creation fails.
- **Contributor tag is not live:** expected until admin approval; check `/admin`.
- **Signed link expired:** refresh Artifact Library or Exports to obtain a new one-hour link.
- **Office document does not render inline:** use Download/Open in a compatible desktop or browser application.

## Static and migration fallback

- Repository Astro content remains a portable seed and static fallback.
- `scripts/generate-exports.mjs` still produces versioned build snapshots from repository content.
- `/pipeline/exports` produces current operational bundles from Supabase.
- Permanent database backups and scheduled GitHub snapshots remain future infrastructure work.
