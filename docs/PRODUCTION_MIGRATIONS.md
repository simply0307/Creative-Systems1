# Creative OS production migration policy

## Canonical identity

The version in `supabase/migrations/<timestamp>_<name>.sql` is the authoritative migration identity. Filenames use a unique 14-digit UTC timestamp and a lowercase snake-case name. Production must record that exact version; it must not invent a replacement timestamp for reviewed SQL.

The canonical production database is Supabase project `creative os` (`okqkljexfzolzxysjaha`). The only normal production schema deployment mechanism is the authenticated Supabase CLI running the reviewed repository migration through:

```text
supabase db push
```

Do not deploy a repository migration through the production SQL Editor, ad-hoc SQL execution, ChatGPT/API `apply_migration`, or an alternate migration runner. Those paths can inspect state when read-only and may perform an explicitly authorized migration-history-only repair, but they must not deploy SQL already represented by a repository migration file.

## Sole writer and serialization

The manual GitHub Actions workflow `.github/workflows/production-supabase-migration.yml` is the sole normal production migration writer. Its repository concurrency group allows one production migration writer at a time and does not cancel an active deployment. Agents, local terminals, other CI jobs, the setup scripts, SQL tools, and alternate migration services must not deploy canonical schema changes independently.

The workflow checks out `simply0307/Creative-Systems1` on `main`, requires the full reviewed commit, accepts only explicitly listed migration versions, pins the Supabase CLI, and calls `scripts/deploy-production-migrations.mjs`. The script also holds an atomic process lock for the duration of the preflight, push, and postflight checks. A stale local lock is evidence to investigate; do not remove it until the prior process is proven inactive.

Required GitHub production-environment secrets are `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. They are never arguments, outputs, or repository files. The `production` environment should require the project owner's approval.

## Required gate

Before the push, the gate proves:

1. The checkout root and `origin` are the canonical repository.
2. Git is clean, the branch is `main`, and `HEAD` equals the approved full commit.
3. The CLI is authenticated and linked only to `okqkljexfzolzxysjaha`.
4. Every migration filename is valid and every version is unique.
5. `supabase migration list --linked` has no remote-only or otherwise unexpected drift; its only local-only versions are the approved versions.
6. `supabase db push --dry-run` contains exactly the approved versions.
7. The project ref and phrase `DEPLOY-CREATIVE-OS-MIGRATIONS` are explicitly confirmed.

The only database write is then `supabase db push`. Seed, role, include-all, reset, migration-up, direct SQL, and repair modes are not selectable through this gate.

Immediately afterward, the gate reruns `supabase migration list --linked`. Local and remote version sets must be exactly equal, every approved version must be present, and any timestamp mismatch is a hard failure.

## History repair exception

Migration-history repair is exceptional and never substitutes for deployment. It may be used only after a fresh recovery checkpoint and proof that the live schema and stored SQL are exactly the reviewed repository migration. Repair changes only `supabase_migrations.schema_migrations`; it does not execute or revert application SQL. Each repair requires explicit authorization and before/after fingerprints.

On 2026-08-10, the already-correct `worker_budget_rpc` schema had been recorded by an API migration tool as `20260810143101` instead of repository version `20260810032000`. After exact SQL, function, ACL, data, Storage, and recovery-checkpoint verification, the official CLI marked `20260810143101` reverted and `20260810032000` applied. No application SQL was rerun and canonical/legacy fingerprints did not change.
