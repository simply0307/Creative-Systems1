import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { authorizeCreativeOsRoute, classifyCreativeOsRoute } from "../netlify/functions/lib/authorization.mjs";
import { RoutedAuthProvider } from "../netlify/functions/lib/auth-provider-router.mjs";
import { localOwnerModeEnabled, resolveIdentity } from "../netlify/functions/lib/identity.mjs";
import { SupabaseAuthProvider } from "../netlify/functions/lib/supabase-auth-provider.mjs";
import { loadProfileForIdentity } from "../netlify/functions/lib/supabase.mjs";
import { withProfileAuthority } from "../src/server/auth/identity.mjs";
import { handleCreativeOsRequest } from "../netlify/functions/creative-os.mjs";

const root = path.resolve(import.meta.dirname, "..");

const jwt = (payload) => [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"),
  "signature",
].join(".");

const futureToken = jwt({ sub: "employee-1", exp: Math.floor(Date.now() / 1000) + 3600 });
const request = (authorization) => ({ rawUrl: "https://example.test/api/creative-os/artifacts", headers: authorization ? { authorization } : {} });
const production = { CREATIVE_OS_RUNTIME_CONTEXT: "production", CREATIVE_OS_LOCAL_OWNER_MODE: "true" };
const local = { CREATIVE_OS_RUNTIME_CONTEXT: "local", CREATIVE_OS_LOCAL_OWNER_MODE: "true" };

test("production missing authentication cannot become owner", async () => {
  const identity = await resolveIdentity(request(), {}, globalThis.fetch, production);
  assert.equal(identity.authenticated, false);
  assert.equal(identity.userRole, "viewer");
  assert.equal(identity.authFailure, "missing");
});

test("malformed bearer credentials fail before verification and cannot become owner", async () => {
  let verified = false;
  const identity = await resolveIdentity(request("Bearer not-a-jwt"), {}, async () => { verified = true; }, production);
  assert.equal(identity.authenticated, false);
  assert.equal(identity.authFailure, "malformed");
  assert.equal(verified, false);
});

test("expired bearer credentials fail before verification and cannot become owner", async () => {
  const expired = jwt({ sub: "employee-1", exp: Math.floor(Date.now() / 1000) - 1 });
  const identity = await resolveIdentity(request(`Bearer ${expired}`), {}, async () => { throw new Error("must not verify expired token"); }, production);
  assert.equal(identity.authenticated, false);
  assert.equal(identity.authFailure, "expired");
});

test("invalid bearer credentials return an authentication failure", async () => {
  const identity = await resolveIdentity(request(`Bearer ${futureToken}`), {}, async () => new Response("invalid", { status: 401 }), production);
  assert.equal(identity.authenticated, false);
  assert.equal(identity.authFailure, "invalid");
  assert.equal(identity.authFailureStatus, 401);
});

test("identity verification outage fails closed as unavailable", async () => {
  const identity = await resolveIdentity(request(`Bearer ${futureToken}`), {}, async () => { throw new Error("network unavailable"); }, production);
  assert.equal(identity.authenticated, false);
  assert.equal(identity.userRole, "viewer");
  assert.equal(identity.authFailure, "verification-unavailable");
  assert.equal(identity.authFailureStatus, 503);
});

test("valid Netlify Identity user is accepted and only trusted app metadata supplies roles", async () => {
  const identity = await resolveIdentity(request(`Bearer ${futureToken}`), {}, async () => Response.json({
    id: "employee-1",
    email: "employee@example.test",
    user_metadata: { full_name: "Employee", roles: ["owner"] },
    app_metadata: { roles: ["editor"] },
  }), production);
  assert.equal(identity.authenticated, true);
  assert.equal(identity.identityVerified, true);
  assert.equal(identity.userRole, "editor");
  assert.equal(identity.authMethod, "netlify-identity");
  assert.equal(identity.provider, "netlify_identity");
  assert.equal(identity.subject, "employee-1");
  assert.equal(identity.verifiedEmail, "employee@example.test");
});

test("browser auth boundary preserves Netlify callbacks and implements Supabase session lifecycle without signup", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const providers = fs.readFileSync(path.join(root, "src/scripts/auth-provider-client.js"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/layouts/AppLayout.astro"), "utf8");
  assert.match(providers, /acceptInvite[\s\S]*handleAuthCallback[\s\S]*from "@netlify\/identity"/);
  assert.match(providers, /callback\?\.type === "invite"/);
  assert.match(accountClient, /pendingInviteToken = restored\.token/);
  assert.match(accountClient, /acceptInvite\(pendingInviteToken, password\)/);
  for (const behavior of ["persistSession: true", "autoRefreshToken: true", "detectSessionInUrl: true", "getSession", "signInWithPassword", "signOut", "resetPasswordForEmail", "updateUser", "onAuthStateChange"]) assert.match(providers, new RegExp(behavior.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(providers, /\.auth\.signUp|\bsignup\s*\(/i);
  assert.match(layout, /data-invite-form/);
  assert.match(layout, /autocomplete="new-password"/);
  assert.doesNotMatch(accountClient, /window\.prompt/);
  assert.match(accountClient, /selected\.login\(email, password\)/);
  assert.match(accountClient, /\[data-login-form\].*addEventListener\("submit", login\)/);
  assert.match(layout, /data-login-form/);
  assert.match(layout, /data-auth-provider/);
  assert.match(layout, /data-login-recovery/);
  assert.match(layout, /autocomplete="username"/);
  assert.match(layout, /autocomplete="current-password"/);
});

test("browser authority is hydrated from the server and Supabase bearer credentials stay same-origin", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const providers = fs.readFileSync(path.join(root, "src/scripts/auth-provider-client.js"), "utf8");
  const apiClient = fs.readFileSync(path.join(root, "src/scripts/creative-os-client.js"), "utf8");
  assert.match(accountClient, /fetch\("\/api\/creative-os\/auth\/session"/);
  assert.match(accountClient, /result\.roleSource \|\| "public\.profiles\.role"/);
  assert.doesNotMatch(accountClient, /app_metadata|user_metadata.*roles/i);
  assert.match(providers, /url\.origin !== window\.location\.origin/);
  assert.match(providers, /authorization: `Bearer \$\{data\.session\.access_token\}`/);
  assert.match(apiClient, /authHeaders\(target\)/);
});

test("explicit local owner mode requires both local runtime and the flag", async () => {
  assert.equal(localOwnerModeEnabled(local), true);
  assert.equal(localOwnerModeEnabled({ CREATIVE_OS_RUNTIME_CONTEXT: "local" }), false);
  const withoutFlag = await resolveIdentity(request(), {}, globalThis.fetch, { CREATIVE_OS_RUNTIME_CONTEXT: "local" });
  assert.equal(withoutFlag.authenticated, false);
  const identity = await resolveIdentity(request(), {}, globalThis.fetch, local);
  assert.equal(identity.authenticated, true);
  assert.equal(identity.userRole, "owner");
  assert.equal(identity.authMethod, "explicit-local-owner");
});

test("production ignores the local owner flag", async () => {
  const identity = await resolveIdentity(request(), {}, globalThis.fetch, production);
  assert.equal(identity.authenticated, false);
  assert.notEqual(identity.authMethod, "explicit-local-owner");
});

test("central policy separates public, authenticated, mutation, and privileged routes", () => {
  assert.equal(classifyCreativeOsRoute("GET", "health").accessClass, "public-health");
  assert.equal(classifyCreativeOsRoute("GET", "artifacts").accessClass, "authenticated-read");
  assert.equal(classifyCreativeOsRoute("POST", "artifacts/a/tags").accessClass, "authenticated-mutation");
  assert.deepEqual(classifyCreativeOsRoute("POST", "imports/repo-metadata"), { accessClass: "privileged", minimumRole: "admin" });
});

test("valid non-owner identity receives 403 for an owner/admin-only route", () => {
  const identity = { authenticated: true, userRole: "editor" };
  assert.throws(() => authorizeCreativeOsRoute(identity, classifyCreativeOsRoute("POST", "imports/repo-metadata")), (error) => error.status === 403);
});

test("verification outage produces 503 while absent identity produces 401", () => {
  const policy = classifyCreativeOsRoute("GET", "artifacts");
  assert.throws(() => authorizeCreativeOsRoute({ authenticated: false, authFailureStatus: 503 }, policy), (error) => error.status === 503);
  assert.throws(() => authorizeCreativeOsRoute({ authenticated: false, authFailureStatus: 401 }, policy), (error) => error.status === 401);
});

test("health, readiness, and full health stay public and bypass profile or application mutations", async () => {
  for (const pathName of ["health", "ready", "health/full"]) {
    const touched = [];
    const supabase = new Proxy({}, { get(_target, property) { touched.push(String(property)); throw new Error("public health touched application state"); } });
    const response = await handleCreativeOsRequest(new Request(`https://example.test/api/creative-os/${pathName}`), {}, {
      config: { configured: true, missing: [], configurationErrors: [] },
      readiness: { ready: true, failures: [], checks: {} },
      supabase,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(touched, []);
  }
});

test("unauthorized mutation is rejected before database, profile, artifact, audit, import, or Storage access", async () => {
  const touched = [];
  const supabase = new Proxy({}, { get(_target, property) { touched.push(String(property)); throw new Error("unauthorized request touched Supabase"); } });
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "Archive/Test" }),
  }), {}, {
    config: { configured: true },
    readiness: { ready: true, failures: [], checks: {} },
    identity: { authenticated: false, userRole: "viewer", authFailure: "missing", authFailureStatus: 401 },
    supabase,
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.databaseWriteAttempted, false);
  assert.deepEqual(touched, []);
});

test("authenticated owner can perform an authorized controlled-value mutation", async () => {
  const mutations = [];
  const resultByTable = {
    tags: { id: "tag-new", name: "New value", slug: "freeform-new-value", tag_type: "freeform", is_active: true },
    audit_events: { id: "audit-new" },
  };
  const supabase = {
    from(table) {
      let operation = "select";
      const chain = {
        select() { return this; },
        eq() { return this; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        insert() { operation = "insert"; mutations.push(table); return this; },
        single() { return Promise.resolve({ data: resultByTable[table], error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: operation === "select" ? [] : resultByTable[table], error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/controlled-values/tags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "New value", tagType: "freeform" }),
  }), {}, {
    config: { configured: true },
    readiness: { ready: true, failures: [], checks: {} },
    identity: { authenticated: true, identityVerified: true, userId: "owner-1", userEmail: "owner@example.test", userName: "Owner", userRole: "owner", authMethod: "netlify-identity" },
    profile: { id: "profile-owner", email: "owner@example.test", role: "owner" },
    supabase,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(mutations, ["tags", "audit_events"]);
});

test("verified provider subjects load one stable profile without email lookup or mutation", async () => {
  const mutations = [];
  const filters = [];
  const existing = { id: "profile-1", email: "editor@example.test", display_name: "Editor", role: "editor", identity_provider: "netlify_identity", identity_user_id: "editor-1" };
  const supabase = {
    from(table) {
      assert.equal(table, "profile_identities");
      return {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        maybeSingle: async () => ({ data: { profile_id: existing.id, provider: "netlify_identity", provider_subject: "editor-1", status: "active", profile: existing }, error: null }),
        insert() { mutations.push("insert"); return this; },
        update() { mutations.push("update"); return this; },
      };
    },
  };
  const profile = await loadProfileForIdentity(supabase, { authenticated: true, identityVerified: true, provider: "netlify_identity", subject: "editor-1" });
  assert.equal(profile.id, "profile-1");
  assert.deepEqual(mutations, []);
  assert.ok(filters.some(([column, value]) => column === "status" && value === "active"));
});

test("revoked identity mappings are denied", async () => {
  const supabase = {
    from: () => ({
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: null, error: null }),
    }),
  };
  await assert.rejects(
    loadProfileForIdentity(supabase, { authenticated: true, identityVerified: true, provider: "supabase_auth", subject: "revoked-subject" }),
    (error) => error.status === 403 && error.code === "identity_not_provisioned",
  );
});

test("pre-migration Netlify identities retain a read-only legacy bridge only when the mapping table is absent", async () => {
  const calls = [];
  const existing = { id: "profile-legacy", email: "owner@example.test", display_name: "Owner", role: "owner", identity_provider: "netlify_identity", identity_user_id: "owner-1" };
  const supabase = {
    from(table) {
      calls.push(table);
      const chain = {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => table === "profile_identities"
          ? ({ data: null, error: { code: "PGRST205", message: "table not found" } })
          : ({ data: existing, error: null }),
      };
      return chain;
    },
  };
  const profile = await loadProfileForIdentity(supabase, { authenticated: true, identityVerified: true, provider: "netlify_identity", subject: "owner-1" });
  assert.equal(profile.id, existing.id);
  assert.deepEqual(calls, ["profile_identities", "profiles"]);
});

test("profile bridge database errors and Supabase identities never trigger the legacy fallback", async () => {
  const calls = [];
  const failing = (code) => ({
    from(table) {
      calls.push(table);
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: { code, message: "database unavailable" } }) };
    },
  });
  await assert.rejects(
    loadProfileForIdentity(failing("08006"), { authenticated: true, identityVerified: true, provider: "netlify_identity", subject: "owner-1" }),
    /Load provider identity bridge:/,
  );
  assert.deepEqual(calls, ["profile_identities"]);
  calls.length = 0;
  await assert.rejects(
    loadProfileForIdentity(failing("PGRST205"), { authenticated: true, identityVerified: true, provider: "supabase_auth", subject: "supabase-1" }),
    /Load provider identity bridge:/,
  );
  assert.deepEqual(calls, ["profile_identities"]);
});

test("profile bridge rejects synthetic, unauthenticated, and unprovisioned identities without creating profiles", async () => {
  const supabase = new Proxy({}, { get() { throw new Error("database must not be touched"); } });
  await assert.rejects(loadProfileForIdentity(supabase, { authenticated: false }), /verified provider identity/i);
  await assert.rejects(loadProfileForIdentity(supabase, { authenticated: true, identityVerified: false, provider: "local", subject: "local" }), /verified provider identity/i);

  const unprovisioned = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }) };
  await assert.rejects(loadProfileForIdentity(unprovisioned, { authenticated: true, identityVerified: true, provider: "supabase_auth", subject: "subject-1" }), (error) => error.status === 403 && error.code === "identity_not_provisioned");
});

test("canonical profile role overrides every provider claim", () => {
  const identity = { authenticated: true, userRole: "owner", roleSource: "token", trustedClaims: { roles: ["owner"] } };
  const effective = withProfileAuthority(identity, { id: "profile-1", role: "editor" });
  assert.equal(effective.userRole, "editor");
  assert.equal(effective.roleSource, "public.profiles.role");
});

test("a mapped profile without a recognized canonical role is denied instead of becoming viewer", () => {
  assert.throws(
    () => withProfileAuthority({ authenticated: true, provider: "supabase_auth", subject: "subject-1" }, { id: "profile-1", role: "unknown" }),
    (error) => error.status === 403 && error.code === "profile_role_invalid",
  );
});

test("Supabase provider verifies the exact bearer with auth.getUser and does not trust token role metadata", async () => {
  const token = jwt({ iss: "https://okqkljexfzolzxysjaha.supabase.co/auth/v1", sub: "supabase-user", exp: Math.floor(Date.now() / 1000) + 3600, aal: "aal1", app_metadata: { roles: ["owner"] } });
  let verifiedToken = null;
  const identity = await new SupabaseAuthProvider().authenticate(new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${token}` } }), {
    supabase: { auth: { getUser: async (candidate) => {
      verifiedToken = candidate;
      return { data: { user: { id: "supabase-user", email: "verified@example.test", email_confirmed_at: "2026-08-10T00:00:00Z", app_metadata: { roles: ["owner"] }, user_metadata: { full_name: "Verified" } } }, error: null };
    } } },
  });
  assert.equal(verifiedToken, token);
  assert.equal(identity.authenticated, true);
  assert.equal(identity.provider, "supabase_auth");
  assert.equal(identity.subject, "supabase-user");
  assert.equal(identity.userRole, "viewer");
  assert.equal(identity.roleSource, "unprovisioned");
  assert.equal(identity.sessionStrength, "aal1");
});

test("Supabase malformed, expired, invalid, and unavailable credentials all fail closed", async () => {
  const provider = new SupabaseAuthProvider();
  let calls = 0;
  const client = (result) => ({ auth: { getUser: async () => { calls += 1; if (result instanceof Error) throw result; return result; } } });
  const malformed = await provider.authenticate(new Request("https://example.test", { headers: { authorization: "Bearer malformed" } }), { supabase: client(null) });
  assert.equal(malformed.authFailure, "malformed");
  const expiredToken = jwt({ sub: "expired", exp: Math.floor(Date.now() / 1000) - 1 });
  const expired = await provider.authenticate(new Request("https://example.test", { headers: { authorization: `Bearer ${expiredToken}` } }), { supabase: client(null) });
  assert.equal(expired.authFailure, "expired");
  assert.equal(calls, 0);

  const currentToken = jwt({ sub: "current", exp: Math.floor(Date.now() / 1000) + 3600 });
  const invalid = await provider.authenticate(new Request("https://example.test", { headers: { authorization: `Bearer ${currentToken}` } }), { supabase: client({ data: { user: null }, error: { status: 401 } }) });
  assert.equal(invalid.authFailure, "invalid");
  assert.equal(invalid.authFailureStatus, 401);
  const unavailable = await provider.authenticate(new Request("https://example.test", { headers: { authorization: `Bearer ${currentToken}` } }), { supabase: client(new Error("offline")) });
  assert.equal(unavailable.authFailure, "verification-unavailable");
  assert.equal(unavailable.authFailureStatus, 503);
  assert.equal(calls, 2);
});

test("the complete role matrix is identical after either provider is mapped to the same profile", () => {
  const policies = [
    [classifyCreativeOsRoute("GET", "artifacts"), ["viewer", "contributor", "editor", "admin", "owner"]],
    [classifyCreativeOsRoute("POST", "artifacts/a/tags"), ["contributor", "editor", "admin", "owner"]],
    [classifyCreativeOsRoute("GET", "review-requests"), ["admin", "owner"]],
  ];
  for (const provider of ["netlify_identity", "supabase_auth"]) {
    for (const role of ["viewer", "contributor", "editor", "admin", "owner"]) {
      const identity = withProfileAuthority({ authenticated: true, provider, subject: `${provider}-${role}`, userRole: "viewer" }, { id: `${provider}-${role}`, role });
      for (const [policy, allowed] of policies) {
        if (allowed.includes(role)) assert.doesNotThrow(() => authorizeCreativeOsRoute(identity, policy));
        else assert.throws(() => authorizeCreativeOsRoute(identity, policy), (error) => error.status === 403);
      }
    }
  }
});

test("dual-provider routing is issuer-deterministic and conflicting credentials fail closed", async () => {
  const calls = [];
  const provider = (name) => ({ authenticate: async () => { calls.push(name); return { authenticated: true, provider: name, userRole: "viewer" }; } });
  const router = new RoutedAuthProvider({ netlifyProvider: provider("netlify"), supabaseProvider: provider("supabase") });
  const environment = { CREATIVE_OS_AUTH_MODE: "dual", SUPABASE_URL: "https://okqkljexfzolzxysjaha.supabase.co" };
  const supabaseToken = jwt({ iss: `${environment.SUPABASE_URL}/auth/v1`, sub: "s", exp: Math.floor(Date.now() / 1000) + 3600 });
  const netlifyToken = jwt({ iss: "https://example.test/.netlify/identity", sub: "n", exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal((await router.authenticate(new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${supabaseToken}` } }), { environment })).provider, "supabase");
  assert.equal((await router.authenticate(new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${netlifyToken}` } }), { environment })).provider, "netlify");
  const conflict = await router.authenticate(new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${supabaseToken}`, cookie: `nf_jwt=${netlifyToken}` } }), { environment });
  assert.equal(conflict.authenticated, false);
  assert.equal(conflict.authFailure, "conflicting-credentials");
  const wrongProjectToken = jwt({ iss: "https://wrong-project.supabase.co/auth/v1", sub: "wrong", exp: Math.floor(Date.now() / 1000) + 3600 });
  const wrongProject = await router.authenticate(new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${wrongProjectToken}` } }), { environment });
  assert.equal(wrongProject.authenticated, false);
  assert.equal(wrongProject.authFailure, "unknown-token-issuer");
  assert.deepEqual(calls, ["supabase", "netlify"]);
});

test("single-provider routing preserves authoritative verification across alternate site origins", async () => {
  const calls = [];
  const provider = (name) => ({ authenticate: async () => { calls.push(name); return { authenticated: true, provider: name, userRole: "viewer" }; } });
  const router = new RoutedAuthProvider({ netlifyProvider: provider("netlify"), supabaseProvider: provider("supabase") });
  const alternateOriginToken = jwt({ iss: "https://primary-site.example/.netlify/identity", sub: "n", exp: Math.floor(Date.now() / 1000) + 3600 });
  const netlify = await router.authenticate(
    new Request("https://deploy-preview.example/api/creative-os/artifacts", { headers: { authorization: `Bearer ${alternateOriginToken}` } }),
    { environment: { CREATIVE_OS_AUTH_MODE: "netlify", SUPABASE_URL: "https://okqkljexfzolzxysjaha.supabase.co" } },
  );
  assert.equal(netlify.provider, "netlify");
  const unknownSupabaseToken = jwt({ iss: "https://unknown.example/auth/v1", sub: "s", exp: Math.floor(Date.now() / 1000) + 3600 });
  const supabase = await router.authenticate(
    new Request("https://example.test/api/creative-os/artifacts", { headers: { authorization: `Bearer ${unknownSupabaseToken}` } }),
    { environment: { CREATIVE_OS_AUTH_MODE: "supabase", SUPABASE_URL: "https://okqkljexfzolzxysjaha.supabase.co" } },
  );
  assert.equal(supabase.provider, "supabase");
  assert.deepEqual(calls, ["netlify", "supabase"]);
});

test("profile identity migration is additive, unique by provider subject, and does not link Supabase users by email", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260810195000_profile_identities.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.profile_identities/);
  assert.match(sql, /unique \(provider, provider_subject\)/);
  assert.match(sql, /linked_at timestamptz not null default now\(\)/);
  assert.match(sql, /linked_by_profile_id uuid references public\.profiles/);
  assert.match(sql, /linked_by_actor text not null/);
  assert.match(sql, /status text not null default 'active'/);
  assert.match(sql, /from public\.profiles[\s\S]*identity_provider = 'netlify_identity'/);
  assert.doesNotMatch(sql, /auth\.users|lower\(.*email|supabase_auth'\s*,/i);
  assert.match(sql, /revoke all on table public\.profile_identities from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.profile_identities to service_role/);
});

test("database security migration removes anonymous RPC and browser trigger execution", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260807224000_harden_direct_function_privileges.sql"), "utf8");
  assert.match(sql, /toggle_comment_resonance\(bigint\)[\s\S]*set search_path = ''/);
  assert.match(sql, /revoke execute on function public\.toggle_comment_resonance\(bigint\) from anon/);
  assert.match(sql, /grant execute on function public\.toggle_comment_resonance\(bigint\) to authenticated/);
  assert.match(sql, /set_updated_at\(\)[\s\S]*security invoker[\s\S]*set search_path = ''/);
  assert.match(sql, /revoke execute on function public\.set_updated_at\(\) from anon, authenticated/);
});

test("resonance RPC cannot choose another user and binds mutation to auth.uid", () => {
  const original = fs.readFileSync(path.join(root, "supabase/migrations/20260720123053_add_authenticated_comment_resonance_votes.sql"), "utf8");
  assert.match(original, /toggle_comment_resonance\(\s*p_comment_id bigint\s*\)/);
  assert.doesNotMatch(original, /p_user_id/);
  assert.match(original, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(original, /if v_user_id is null then/);
});
