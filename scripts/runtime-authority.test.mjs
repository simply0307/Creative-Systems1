import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const operationsRoute = ["/api", "/operations"].join("");

const collectText = (relative, extensions = /\.(?:astro|html|js|mjs|ts|css|json|toml)$/) => {
  const files = [];
  const visit = (child) => {
    const absolute = path.join(root, child);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const nested = path.join(child, entry.name);
      if (entry.isDirectory()) visit(nested);
      else if (extensions.test(entry.name)) files.push(nested);
    }
  };
  visit(relative);
  return files.map((file) => read(file)).join("\n");
};

test("only the authoritative Creative OS Netlify function and routes remain", () => {
  const functions = fs.readdirSync(path.join(root, "netlify/functions"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
  const config = read("netlify.toml");
  assert.deepEqual(functions, ["creative-os.mjs"]);
  assert.match(config, /from = "\/api\/creative-os\/\*"[\s\S]*to = "\/\.netlify\/functions\/creative-os\?splat=:splat"/);
  assert.doesNotMatch(config, new RegExp(operationsRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(exists("netlify/functions/operations.mjs"), false);
});

test("legacy Operations clients, local authority keys, and GitHub mutation helpers are absent", () => {
  for (const file of [
    "public/operations-client.js",
    "netlify/functions/lib/github-adapter.mjs",
    "netlify/functions/lib/operation-planner.mjs",
    "src/data/operation-lifecycle.mjs",
    "src/data/operation-policies.mjs",
  ]) assert.equal(exists(file), false, `${file} must stay retired`);

  const shipped = [collectText("public"), collectText("src")].join("\n");
  assert.doesNotMatch(shipped, /operations-client\.js|eggs-creative-os-local-changes|eggs-creative-os-local-operations|eggs-creative-os-admin-key/);
  assert.doesNotMatch(shipped, new RegExp(operationsRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Archive initialization is read-only and import is an explicit privileged confirmation", () => {
  const source = read("src/scripts/archive-index-client.js");
  const page = read("src/pages/pipeline/artifacts.astro");
  const loadBody = source.slice(source.indexOf("const load = async"), source.indexOf("const differenceByName"));
  assert.doesNotMatch(loadBody, /importArchiveFolderIndex|importArchiveSnapshot|method:\s*["']POST/);
  assert.match(page, /id="import-archive-snapshot"[^>]*disabled/);
  assert.match(page, /Admin\/owner only/);
  assert.match(source, /\["admin", "owner"\]\.includes\(account\.userRole\)/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /CreativeDatabase\.importArchiveFolderIndex\(\)/);
  assert.match(source, /Repository snapshot import cancelled; no data was changed/);
});

test("maintenance writers remain dry-run by default and require target, readiness, and production confirmation", () => {
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
