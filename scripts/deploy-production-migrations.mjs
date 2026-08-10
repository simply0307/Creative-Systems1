import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CANONICAL_PROJECT_REF = "okqkljexfzolzxysjaha";
export const CANONICAL_REPOSITORY = "simply0307/Creative-Systems1";
export const CANONICAL_BRANCH = "main";
export const PRODUCTION_CONFIRMATION = "DEPLOY-CREATIVE-OS-MIGRATIONS";
export const MIGRATION_FILENAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export const SUPABASE_COMMANDS = Object.freeze({
  link: ["link", "--project-ref", CANONICAL_PROJECT_REF, "--yes", "--output-format", "json"],
  projects: ["projects", "list", "--output-format", "json"],
  historyBefore: ["migration", "list", "--linked", "--output-format", "json"],
  dryRun: ["db", "push", "--dry-run", "--linked", "--output-format", "json"],
  push: ["db", "push", "--linked", "--yes", "--output-format", "json"],
  historyAfter: ["migration", "list", "--linked", "--output-format", "json"],
});

const fail = (message) => {
  throw new Error(message);
};

const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));

export const parseGateArguments = (argv) => {
  const allowedValues = new Set([
    "--expected-branch",
    "--expected-commit",
    "--expected-migrations",
    "--confirm-project-ref",
    "--confirm-production",
  ]);
  const values = new Map();
  let apply = false;

  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    const separator = argument.indexOf("=");
    if (separator < 0) fail(`Unsupported argument: ${argument}`);
    const name = argument.slice(0, separator);
    if (!allowedValues.has(name) || values.has(name)) fail(`Unsupported or duplicate argument: ${name}`);
    values.set(name, argument.slice(separator + 1).trim());
  }

  const expectedBranch = values.get("--expected-branch");
  const expectedCommit = values.get("--expected-commit");
  const expectedMigrations = (values.get("--expected-migrations") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const confirmProjectRef = values.get("--confirm-project-ref");
  const confirmProduction = values.get("--confirm-production");

  if (!apply) fail("Production migration deployment requires --apply.");
  if (expectedBranch !== CANONICAL_BRANCH) fail(`Expected branch must be ${CANONICAL_BRANCH}.`);
  if (!/^[0-9a-f]{40}$/i.test(expectedCommit || "")) fail("Expected commit must be a full 40-character Git SHA.");
  if (expectedMigrations.length === 0 || expectedMigrations.some((version) => !/^\d{14}$/.test(version))) {
    fail("Expected migrations must be a comma-separated list of 14-digit versions.");
  }
  if (new Set(expectedMigrations).size !== expectedMigrations.length) fail("Expected migration versions must be unique.");
  if (confirmProjectRef !== CANONICAL_PROJECT_REF) fail("Canonical project confirmation does not match.");
  if (confirmProduction !== PRODUCTION_CONFIRMATION) fail("Production confirmation phrase does not match.");

  return { expectedBranch, expectedCommit: expectedCommit.toLowerCase(), expectedMigrations, apply };
};

export const validateMigrationFiles = (filenames) => {
  const versions = new Map();
  for (const filename of filenames) {
    const match = filename.match(MIGRATION_FILENAME);
    if (!match) fail(`Invalid migration filename: ${filename}`);
    if (versions.has(match[1])) fail(`Duplicate migration version ${match[1]}: ${versions.get(match[1])}, ${filename}`);
    versions.set(match[1], filename);
  }
  return versions;
};

const versionsFromHistory = (history, key) => new Set(
  (history.migrations || []).map((entry) => String(entry[key] || "").trim()).filter(Boolean),
);

export const assertPrePushHistory = (history, expectedVersions) => {
  const expected = new Set(expectedVersions);
  const local = versionsFromHistory(history, "local");
  const remote = versionsFromHistory(history, "remote");
  const remoteOnly = [...remote].filter((version) => !local.has(version));
  const localOnly = new Set([...local].filter((version) => !remote.has(version)));
  if (remoteOnly.length > 0) fail(`Unexpected remote-only migration versions: ${remoteOnly.join(", ")}`);
  if (!sameSet(localOnly, expected)) {
    fail(`Pending migration versions do not exactly match the approved set. Pending: ${[...localOnly].join(", ") || "none"}.`);
  }
  return { local, remote, pending: localOnly };
};

export const extractDryRunVersions = (dryRun) => {
  const versions = new Set();
  for (const migration of dryRun.migrations || []) {
    const matches = JSON.stringify(migration).match(/\d{14}/g) || [];
    for (const version of matches) versions.add(version);
  }
  return versions;
};

export const assertDryRun = (dryRun, expectedVersions) => {
  const expected = new Set(expectedVersions);
  const actual = extractDryRunVersions(dryRun);
  if (!sameSet(actual, expected)) {
    fail(`Supabase dry run did not exactly match the approved versions. Dry run: ${[...actual].join(", ") || "none"}.`);
  }
};

export const assertPostPushHistory = (history, expectedVersions) => {
  const local = versionsFromHistory(history, "local");
  const remote = versionsFromHistory(history, "remote");
  if (!sameSet(local, remote)) fail("Local and remote migration versions differ after production push.");
  for (const version of expectedVersions) {
    if (!remote.has(version)) fail(`Expected migration ${version} is not recorded remotely after production push.`);
  }
};

const parseJson = (result, label) => {
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    fail(`${label} did not return valid JSON.`);
  }
};

const resolveCommand = (root, name) => {
  const candidates = process.platform === "win32"
    ? [path.join(root, "node_modules", ".bin", `${name}.cmd`), path.join(root, "node_modules", ".bin", `${name}.exe`)]
    : [path.join(root, "node_modules", ".bin", name)];
  const local = candidates.find((candidate) => fs.existsSync(candidate));
  return local || name;
};

const defaultRunner = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd,
  env: process.env,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
});

const git = (runner, root, args) => {
  const result = runner("git", args, { cwd: root });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed.`);
  return String(result.stdout || "").trim();
};

const normalizeRepository = (remote) => remote
  .replace(/^git@github\.com:/i, "")
  .replace(/^https:\/\/github\.com\//i, "")
  .replace(/\.git$/i, "")
  .replace(/\/$/, "");

const assertInsideRoot = (root, target) => {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("Refusing lock operation outside the repository.");
};

const acquireLock = (root, commit) => {
  const parent = path.join(root, ".generated", "locks");
  const lock = path.join(parent, `production-migrations-${CANONICAL_PROJECT_REF}.lock`);
  assertInsideRoot(root, lock);
  fs.mkdirSync(parent, { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error?.code === "EEXIST") fail(`A production migration process already holds ${lock}.`);
    throw error;
  }
  fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, commit, startedAt: new Date().toISOString() }, null, 2)}\n`);
  return () => {
    assertInsideRoot(root, lock);
    fs.rmSync(lock, { recursive: true, force: true });
  };
};

export const runProductionMigrationGate = ({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), runner = defaultRunner } = {}) => {
  const request = parseGateArguments(argv);
  if (env.GITHUB_ACTIONS !== "true" || env.CREATIVE_OS_PRODUCTION_MIGRATION_RUNNER !== "github-actions") {
    fail("Normal production migrations may run only through the serialized GitHub Actions workflow.");
  }
  if (env.GITHUB_REPOSITORY !== CANONICAL_REPOSITORY) fail("GitHub Actions repository identity does not match Creative OS.");

  const root = path.resolve(git(runner, cwd, ["rev-parse", "--show-toplevel"]));
  if (root !== path.resolve(cwd)) fail("Run the production migration gate from the repository root.");
  if (normalizeRepository(git(runner, root, ["remote", "get-url", "origin"])) !== CANONICAL_REPOSITORY) fail("Git origin is not the canonical Creative OS repository.");
  if (git(runner, root, ["status", "--porcelain=v1", "--untracked-files=all"])) fail("Git working tree must be clean.");
  if (git(runner, root, ["branch", "--show-current"]) !== request.expectedBranch) fail("Checked-out branch does not match the approved branch.");
  if (git(runner, root, ["rev-parse", "HEAD"]).toLowerCase() !== request.expectedCommit) fail("Checked-out commit does not match the approved commit.");

  const migrationDir = path.join(root, "supabase", "migrations");
  const migrationVersions = validateMigrationFiles(fs.readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name));
  for (const version of request.expectedMigrations) {
    if (!migrationVersions.has(version)) fail(`Approved migration ${version} does not exist in the repository.`);
  }

  const releaseLock = acquireLock(root, request.expectedCommit);
  const supabase = resolveCommand(root, "supabase");
  try {
    parseJson(runner(supabase, SUPABASE_COMMANDS.link, { cwd: root }), "Supabase project link");
    const linkedRef = fs.readFileSync(path.join(root, "supabase", ".temp", "project-ref"), "utf8").trim();
    if (linkedRef !== CANONICAL_PROJECT_REF) fail("Linked Supabase project ref does not match canonical production.");

    const projects = parseJson(runner(supabase, SUPABASE_COMMANDS.projects, { cwd: root }), "Supabase project inventory");
    const linked = (projects.projects || []).filter((project) => project.linked);
    if (linked.length !== 1 || linked[0].ref !== CANONICAL_PROJECT_REF) fail("Authenticated Supabase CLI is not linked only to canonical production.");

    const before = parseJson(runner(supabase, SUPABASE_COMMANDS.historyBefore, { cwd: root }), "Pre-push migration history");
    assertPrePushHistory(before, request.expectedMigrations);

    const dryRun = parseJson(runner(supabase, SUPABASE_COMMANDS.dryRun, { cwd: root }), "Production migration dry run");
    assertDryRun(dryRun, request.expectedMigrations);

    parseJson(runner(supabase, SUPABASE_COMMANDS.push, { cwd: root }), "Production migration push");

    const after = parseJson(runner(supabase, SUPABASE_COMMANDS.historyAfter, { cwd: root }), "Post-push migration history");
    assertPostPushHistory(after, request.expectedMigrations);

    return {
      repository: CANONICAL_REPOSITORY,
      branch: request.expectedBranch,
      commit: request.expectedCommit,
      projectRef: CANONICAL_PROJECT_REF,
      appliedVersions: request.expectedMigrations,
      historySynchronized: true,
    };
  } finally {
    releaseLock();
  }
};

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  try {
    console.log(JSON.stringify(runProductionMigrationGate(), null, 2));
  } catch (error) {
    console.error(`Production migration gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}
