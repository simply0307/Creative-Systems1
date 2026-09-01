import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import operations from "../netlify/functions/operations.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const invoke = (method, body, pathName = "/api/operations") => operations(new Request(`https://example.test${pathName}`, { method, body, headers: body === undefined ? {} : { "content-type": "application/json" } }));

const expectGone = async (response) => {
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.retired, true);
  assert.equal(body.successor, "/api/creative-os");
  assert.equal(body.mutationAuthority, "creative-os-api");
};

test("GET /api/operations is gone", async () => expectGone(await invoke("GET")));
test("POST /api/operations is gone", async () => expectGone(await invoke("POST", "{}")));
test("invalid JSON is indistinguishable from a valid request", async () => expectGone(await invoke("POST", "{not-json")));
test("valid historical operation payload is still gone", async () => expectGone(await invoke("POST", JSON.stringify({ action: "metadata.update", targets: ["artifact.sample"], changes: { addTags: ["motif"] } }))));
test("all paths reaching the compatibility function are gone", async () => expectGone(await invoke("DELETE", undefined, "/.netlify/functions/operations/anything")));

test("direct function invocation returns a Web Response with 410", async () => {
  const response = await operations({ method: "PATCH" });
  assert.ok(response instanceof Response);
  await expectGone(response);
});

test("OPTIONS remains a bodyless compatibility preflight", async () => {
  const response = await invoke("OPTIONS");
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("the tombstone never reads the request body", async () => {
  const request = { method: "POST" };
  Object.defineProperty(request, "body", { get: () => { throw new Error("body accessed"); } });
  Object.defineProperty(request, "text", { get: () => { throw new Error("text accessed"); } });
  await expectGone(await operations(request));
});

test("a throwing global fetch cannot affect the tombstone", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network access attempted"); };
  try { await expectGone(await operations({ method: "POST" })); }
  finally { globalThis.fetch = previous; }
});

test("the tombstone is dependency-free and has no mutation vocabulary", () => {
  const source = read("netlify/functions/operations.mjs");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /fetch\s*\(|supabase|storage\.|identity|github|admin[_-]?key|localStorage|request\.(?:body|text)|\.text\s*\(/i);
  assert.doesNotMatch(source, /branch|commit|pull request|comment|review|merge/i);
});

test("the historical compatibility function remains in source but is not packaged for Reath", () => {
  const config = read("netlify.toml");
  assert.ok(fs.existsSync(path.join(root, "netlify/functions/operations.mjs")));
  assert.match(config, /functions = "netlify\/reath-functions"/);
  assert.doesNotMatch(config, /\/api\/operations|\/api\/creative-os/);
  for (const entrypoint of ["reath-api.mts", "reath-ingest-background.mts", "reath-ai-background.mts"]) {
    assert.ok(fs.existsSync(path.join(root, "netlify/reath-functions", entrypoint)));
  }
});

test("no shipped browser source contains the retired endpoint, client, or local keys", () => {
  const roots = ["public", "src"];
  const files = [];
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:astro|html|js|mjs|ts|css|json)$/.test(entry.name)) files.push(child);
    }
  };
  roots.forEach(visit);
  const shipped = files.map((file) => read(file)).join("\n");
  assert.doesNotMatch(shipped, /\/api\/operations|operations-client\.js|eggs-creative-os-local-changes|eggs-creative-os-local-operations|eggs-creative-os-admin-key/);
  assert.equal(fs.existsSync(path.join(root, "public/operations-client.js")), false);
});

test("the Reath cutover retires legacy pipeline routes and generated Archive inputs", () => {
  assert.equal(fs.existsSync(path.join(root, "src/pages/pipeline/index.astro")), false);
  assert.equal(fs.existsSync(path.join(root, "src/pages/pipeline/artifacts.astro")), false);
  assert.equal(fs.existsSync(path.join(root, "src/generated/repo-import-manifest.json")), false);
  assert.equal(fs.existsSync(path.join(root, "public/exports")), false);
  assert.match(read("astro.config.mjs"), /publicDir:\s*["']public-reath["']/);
});

test("direct maintenance writers require apply, exact project identity, readiness, and production confirmation", () => {
  const metadata = read("scripts/import-supabase.mjs");
  const files = read("scripts/import-workspace-files.mjs");
  const wrapper = read("scripts/setup-import-apply.mjs");
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const source of [metadata, files]) {
    assert.match(source, /process\.argv\.includes\("--apply"\)/);
    assert.match(source, /--confirm-project-ref=/);
    assert.match(source, /confirmedProjectRef !== config\.projectRef/);
    assert.match(source, /--confirm-production/);
    assert.match(source, /runRuntimeReadiness/);
  }
  assert.equal(scripts["supabase:seed"], "node scripts/import-supabase.mjs");
  assert.equal(scripts["supabase:files"], "node scripts/import-workspace-files.mjs");
  assert.match(scripts["supabase:seed:apply"], /--apply/);
  assert.match(scripts["supabase:files:apply"], /--apply/);
  assert.match(wrapper, /--confirm-project-ref=/);
  assert.match(wrapper, /--confirm-production/);
  assert.match(wrapper, /Type IMPORT to continue/);
});

test("repository export review files cannot enter the public build", () => {
  const generator = read("scripts/generate-exports.mjs");
  assert.match(generator, /\.generated\/exports/);
  assert.doesNotMatch(generator, /public\/exports/);
  assert.match(read(".gitignore"), /^\.generated\/$/m);
  const publicExports = path.join(root, "public/exports");
  assert.deepEqual(fs.existsSync(publicExports) ? fs.readdirSync(publicExports) : [], []);
});
