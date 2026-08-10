# Supabase Auth dual-provider transition

## Status

This document describes the unmerged Phase B candidate. Production authentication remains Netlify Identity. No Supabase schema, Auth user, profile, Storage object, Netlify variable, or deployment was changed by preparing it.

At the 2026-08-10 audit:

- canonical Supabase is `creative os` (`okqkljexfzolzxysjaha`);
- it has one confirmed email Auth user that has signed in;
- that Auth user has no trusted application-role metadata;
- its email correlates with one existing owner profile, but its Supabase subject does not equal that profile's Netlify subject;
- email correlation is not identity proof, so the user remains unprovisioned;
- the three Creative OS profiles remain two Netlify owner profiles and one system owner profile;
- current production Netlify deploy `6a775fd1f6f2490009147d99` still runs commit `a0280c3e2532b0bd94b493cabf3c7c556c60e0d4` with Netlify Identity.

## Server boundary

`AuthProvider.authenticate(request, context)` returns a normalized proof with provider, immutable provider subject, verified email when present, trusted claims, session strength, compatibility user fields, and explicit failure state.

Provider routing is deterministic:

| Server mode | Accepted proof |
|---|---|
| `netlify` | trusted Netlify invocation context, Netlify bearer, or `nf_jwt` |
| `dual` | Netlify proof or a bearer whose issuer exactly matches the configured canonical Supabase Auth issuer |
| `supabase` | canonical Supabase bearer only |

Malformed, expired, unknown-issuer, mixed-provider, disabled-provider, invalid, and unverifiable credentials fail closed. Supabase verification calls the trusted Auth server with `auth.getUser(jwt)`. A decoded token is used only after that verification to normalize session-strength claims.

## Authorization and provisioning

`public.profiles.role` is the sole Creative OS role authority. The accepted roles remain `viewer`, `contributor`, `editor`, `admin`, and `owner`. Netlify `app_metadata.roles` is still a trusted Identity claim but no longer determines effective Creative OS authority after the profile is loaded. User-editable metadata never grants authority.

Pending migration `20260810195000_profile_identities.sql` creates:

- stable `profile_id` reference;
- `provider` (`netlify_identity` or `supabase_auth`);
- immutable `provider_subject`;
- unique `(provider, provider_subject)`;
- RLS with no browser-role access.

The migration seeds current Netlify subject links from historical profile columns. It does not query `auth.users`, match email, create a profile, change a role, or provision Supabase Auth.

To keep the normal Git deployment safe before the separately controlled migration runs, server code has one narrow compatibility read: when and only when PostgreSQL/PostgREST reports that `profile_identities` does not exist, a verified Netlify subject may load its existing `profiles.identity_user_id` row. It performs no write. Once the table exists, every provider must resolve through it; missing mappings and ordinary database errors fail closed. Supabase subjects never use the legacy fallback.

Provisioning the current Supabase Auth subject requires a separate, explicit owner confirmation that identifies the intended existing profile and the exact Supabase subject. That later action must create one `profile_identities` row and verify that the effective role comes from the selected profile. Do not infer or execute this link from email.

## Browser modes

The static client uses:

- `PUBLIC_CREATIVE_OS_AUTH_MODE=netlify|dual|supabase`;
- `PUBLIC_SUPABASE_URL`;
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Supabase browser mode persists and refreshes sessions, detects callback sessions, signs in with password, signs out, sends password recovery, updates a recovered password, and observes Auth state changes. It exposes no service-role credential and sends a bearer only to the current site origin. There is no Creative OS signup path.

In `dual` mode the login form requires an explicit provider choice and signs out the alternate provider before establishing the selected session. The API independently rejects conflicting credentials.

## Signup audit

The repository contains no browser signup call. The existing comments and resonance schema directly references `auth.users`, and `toggle_comment_resonance` intentionally remains available to the Supabase `authenticated` role. Because other consumers may rely on project-wide Supabase Auth enrollment, Phase B does not change the global signup setting. Creative OS provisioning is closed independently: a valid Auth account without a subject link receives no profile or role and is rejected with `403 identity_not_provisioned`.

## Custom access-token hook decision

Do not enable a custom access-token hook in this phase. A token role would be a derivative cache, would require refresh to observe role changes, and would not remove the need to resolve the stable profile mapping. One server-side mapping/profile read keeps authorization current and remains within the measured request budget.

## Migration and release gate

The repository migration timestamp is authoritative. The only allowed production application path is `.github/workflows/production-supabase-migration.yml`, whose sole write is guarded `supabase db push`.

At audit time the GitHub `production` environment and its required `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` secrets do not exist. Therefore the migration must remain unapplied. Before any application:

1. Create the GitHub `production` environment with owner approval.
2. Add the two required environment secrets.
3. Merge the reviewed migration to `main`.
4. Run the manual workflow with the exact main commit and migration `20260810195000`.
5. Verify migration history, table ACL/RLS, two seeded Netlify links, zero Supabase links, and unchanged Creative OS data/Storage counts.
6. Configure a non-production deploy for `dual` browser/server mode.
7. Separately authorize and perform exact-subject owner provisioning.
8. Prove Netlify and Supabase role parity before any production switch.

Cloudflare canary work is not ready until this migration, provisioning, and dual-provider verification are complete. Netlify Identity must remain available as the production and rollback provider meanwhile.
