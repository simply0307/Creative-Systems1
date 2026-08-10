# Creative OS runtime operations

## Authoritative mutation path

Canonical Creative OS state lives in Supabase project `okqkljexfzolzxysjaha`. Routine reads and writes use `/api/creative-os/*`; the runtime contract declares mutation authority `creative-os-api` and fails closed on a project, schema, or Storage mismatch.

The static repository manifest is reference/bootstrap input. It is neither live state nor an alternate authority. Browser-local values and repository-generated files cannot be promoted into canonical state.

## Retired compatibility endpoint

`/api/operations` remains routed to the `operations` Netlify function for one compatibility release. The dependency-free function returns:

- `OPTIONS`: HTTP 204.
- Every other method and payload: HTTP 410 Gone with `/api/creative-os` identified as the successor.

The tombstone does not parse a body, authenticate a user, inspect credentials, call a remote service, or perform a mutation. The legacy browser client and GitHub mutation implementation have been removed. After one normal production release and review of the available Netlify function-log window, the compatibility redirect and function may be removed in a separately reviewed change.

## Archive repository snapshot

Opening or refreshing `/pipeline/artifacts/` performs reads only. The bundled repository manifest can show files not yet represented in canonical Supabase, but missing records never trigger an import.

An authenticated `admin` or `owner` may select **Review and import**. The control reports what it will add and requires confirmation before calling `POST /api/creative-os/imports/archive-folder`. The API independently verifies the trusted Netlify Identity role, runtime readiness, and target project, and creates its normal audit record. The action imports metadata only; source-file bytes require the separate private file-import flow.

Artifact browsing uses deterministic 24-item pages with a maximum requested page size of 50. Only current-page private previews are batch-signed. Full downloads require a separate authenticated five-minute grant. Browser and API upload validation both reject files above 50 MB before any upload begins.

## Maintenance imports

Maintenance scripts are recovery/bootstrap tools outside normal application behavior. First inspect read-only reports:

```powershell
npm run supabase:seed
npm run supabase:files:dry
npm run supabase:files
npm run setup:import
```

The first two commands are dry-run by default. Direct writes require all of:

- the explicit `:apply` command;
- an exact `--confirm-project-ref=<configured-ref>` argument;
- a compatible runtime contract and successful readiness checks;
- `--confirm-production` when the target is production or canonical.

Example for a deliberately reviewed non-production target:

```powershell
npm run supabase:seed:apply -- --confirm-project-ref=YOUR_NON_PRODUCTION_REF
npm run supabase:files:apply -- --confirm-project-ref=YOUR_NON_PRODUCTION_REF
```

For guided canonical work, run `npm run setup:import:apply` and type `IMPORT` when prompted. A non-interactive guided run must include `--confirm-import`. The wrapper revalidates the runtime, passes the exact configured project ref and required production confirmation to both writers, and records completion. Never call `supabase db reset` as an import shortcut.

## Static build export disposition

The previous production build anonymously served 11 repository-derived files: nine classified bundles plus `archive-index.json` and `export-manifest.json` supporting indexes. The bundle metadata classified them as private, internal, private-review, internal-template, or only a public candidate:

| Bundle | Classification |
|---|---|
| Artifact Index | private |
| Canon Bible | internal |
| Decision Queue | private |
| Faction Pack | internal |
| Full Creative OS | private |
| Para Pack | private-review |
| Project Starter Pack | internal-template |
| Public Archive | public-candidate; publication review required |
| Remediation Report | private |

No bundle has final publication approval. The build therefore stages them in ignored `.generated/exports/`, outside `public/` and the deployed `dist/`. These review files are not canonical exports. Canonical export records and private object bytes remain in Supabase and are accessed through `/api/creative-os/exports` with authorization.

## Fast automated setup

Copy the project URL and publishable/server credentials from Supabase **Settings → API Keys** into ignored `.env`: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`. Also declare contract version `1`, authority `creative-os-api`, the runtime context, and the private `artifacts`, `exports`, `imports-raw`, `imports-processed`, and `thumbnails` buckets. Never put the service-role credential in browser code.

1. Copy `.env.example` to ignored `.env` and fill the explicit runtime identity.
2. Run `npm run setup:check`.
3. Run `npm run setup:supabase` to inspect migration status.
4. Run `npm run setup:netlify` only when deliberately configuring an approved context.
5. Run `npm run setup:import` for a read-only import report.
6. Use `npm run setup:verify -- --url=https://SITE.netlify.app` for read-only runtime verification.

The top-level `npm run setup` stops before the real import. If automated migration support is unavailable, follow the printed **Safe migration fallback** and review the exact migration in the Supabase SQL Editor; do not improvise a partial schema.

After an authorized source merge, use the normal Git-connected Netlify **Trigger deploy** workflow. `/api/creative-os/health/full` remains a read-only compatibility alias for readiness.

## Final live acceptance checklist

After a later authorized merge and normal Git-connected Netlify deploy, the exact acceptance test is:

1. `/` returns 200.
2. `/api/creative-os/health` returns 200.
3. `/api/creative-os/ready` returns 200 with `ready: true` and the canonical version-1 contract.
4. Owner artifact and review reads succeed; anonymous and invalid authentication fail closed.
5. GET and POST `/api/operations`, plus direct `/.netlify/functions/operations`, return 410; OPTIONS returns 204.
6. Those probes create no GitHub or Supabase mutation and no Storage change.
7. Loading and refreshing `/pipeline/artifacts/` creates no import request.
8. Browsing, filtering, preview, and download still work; only a deliberate confirmed admin/owner action can import snapshot metadata.
9. Deployed output contains no `operations-client.js`, no legacy browser bundle references, and no `exports/` static directory.
10. The legacy Supabase evidence project remains unchanged.
