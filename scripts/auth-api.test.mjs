import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { authorizeCreativeOsRoute, classifyCreativeOsRoute } from "../netlify/functions/lib/authorization.mjs";
import { localOwnerModeEnabled, resolveIdentity } from "../netlify/functions/lib/identity.mjs";
import { ensureProfile } from "../netlify/functions/lib/supabase.mjs";
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
});

test("account client completes invite callbacks with an explicit password acceptance flow", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/layouts/AppLayout.astro"), "utf8");
  assert.match(accountClient, /import \{[^}]*acceptInvite[^}]*handleAuthCallback[^}]*\} from "@netlify\/identity"/);
  assert.match(accountClient, /callback\?\.type === "invite"/);
  assert.match(accountClient, /pendingInviteToken = callback\.token/);
  assert.match(accountClient, /acceptInvite\(pendingInviteToken, password\)/);
  assert.match(layout, /data-invite-form/);
  assert.match(layout, /autocomplete="new-password"/);
});

test("account client uses an inline Identity login form instead of blocked browser prompts", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/layouts/AppLayout.astro"), "utf8");
  assert.doesNotMatch(accountClient, /window\.prompt/);
  assert.match(accountClient, /identityLogin\(email, password\)/);
  assert.match(accountClient, /\[data-login-form\].*addEventListener\("submit", login\)/);
  assert.match(layout, /data-login-form/);
  assert.match(layout, /autocomplete="username"/);
  assert.match(layout, /autocomplete="current-password"/);
});

test("authenticated Identity users can set a reusable password without creating another account", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/layouts/AppLayout.astro"), "utf8");
  assert.match(accountClient, /updateUser as updateIdentityUser/);
  assert.match(accountClient, /updateIdentityUser\(\{ password \}\)/);
  assert.match(accountClient, /callback\?\.type === "recovery"/);
  assert.match(accountClient, /event === AUTH_EVENTS\.RECOVERY/);
  assert.match(layout, /data-password-open/);
  assert.match(layout, /data-password-form/);
  assert.match(layout, /Set or change password/);
  assert.doesNotMatch(accountClient, /signup\(/);
});

test("mobile users can open the Identity account panel and recovery opens it automatically", () => {
  const accountClient = fs.readFileSync(path.join(root, "src/scripts/account-client.js"), "utf8");
  const layout = fs.readFileSync(path.join(root, "src/layouts/AppLayout.astro"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles/global.css"), "utf8");
  assert.match(layout, /data-account-drawer/);
  assert.match(layout, /data-account-drawer-open/);
  assert.match(layout, /data-account-drawer-close/);
  assert.match(accountClient, /callback\?\.type === "recovery"[\s\S]*setAccountDrawer\(true\)[\s\S]*showPasswordForm\(true\)/);
  assert.match(accountClient, /event === AUTH_EVENTS\.RECOVERY[\s\S]*setAccountDrawer\(true\)[\s\S]*showPasswordForm\(true\)/);
  assert.match(styles, /\.sidebar\.account-drawer-open\s*\{[^}]*display:flex/);
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

test("unchanged verified profile reads do not upsert or update", async () => {
  const mutations = [];
  const existing = { id: "profile-1", email: "editor@example.test", display_name: "Editor", role: "editor", identity_provider: "netlify_identity", identity_user_id: "editor-1" };
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: existing, error: null }),
        insert() { mutations.push("insert"); return this; },
        update() { mutations.push("update"); return this; },
      };
    },
  };
  const profile = await ensureProfile(supabase, { authenticated: true, identityVerified: true, userId: "editor-1", userEmail: "editor@example.test", userName: "Editor", userRole: "editor", authMethod: "netlify-identity" });
  assert.equal(profile.id, "profile-1");
  assert.deepEqual(mutations, []);
});

test("profile bridge rejects synthetic or unauthenticated identities before database access", async () => {
  const supabase = new Proxy({}, { get() { throw new Error("database must not be touched"); } });
  await assert.rejects(ensureProfile(supabase, { authenticated: false }), /verified Netlify Identity/i);
  await assert.rejects(ensureProfile(supabase, { authenticated: true, identityVerified: false, authMethod: "explicit-local-owner" }), /verified Netlify Identity/i);
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
