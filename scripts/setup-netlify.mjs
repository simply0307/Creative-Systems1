import process from "node:process";
import {
  envIsSet,
  loadLocalEnv,
  maskSecrets,
  readNetlifySiteId,
  resolveCommand,
  runCommand,
} from "./lib/setup-utils.mjs";

loadLocalEnv();

const names = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET_ARTIFACTS",
  "SUPABASE_STORAGE_BUCKET_EXPORTS",
];
const missing = names.filter((name) => !envIsSet(name));
if (missing.length) {
  console.error(`Cannot configure Netlify. Add ${missing.join(", ")} to .env first.`);
  process.exit(1);
}

const cli = resolveCommand("netlify");
if (!cli) {
  console.error("Netlify CLI is missing. Install it with: npm install --save-dev netlify-cli");
  console.error("Then run: netlify login && netlify link && npm run setup:netlify");
  process.exit(1);
}

const siteId = readNetlifySiteId();
if (!siteId) {
  console.error("No linked Netlify site was found. Run `netlify login` and `netlify link`, or add NETLIFY_SITE_ID to .env.");
  process.exit(1);
}

console.log("Setting the five Creative OS Supabase variables on the linked Netlify site…");
for (const name of names) {
  const args = ["env:set", name, process.env[name], "--site", siteId];
  if (name === "SUPABASE_SERVICE_ROLE_KEY") args.push("--secret");
  const result = runCommand(cli, args, { print: false });
  const output = maskSecrets(`${result.stdout || ""}${result.stderr || ""}`);
  if (result.status !== 0) {
    console.error(`Failed to set ${name}. ${output.trim()}`);
    process.exit(1);
  }
  console.log(`Set ${name} (value hidden).`);
}

console.log("\nNetlify environment variables are configured. Environment changes require a new deploy.");
const deployArgs = ["deploy", "--prod", "--build", "--site", siteId];
if (process.argv.includes("--deploy")) {
  console.log("Running an explicitly requested production build and deploy…");
  const deployed = runCommand(cli, deployArgs, { capture: false });
  if (deployed.status !== 0) process.exit(deployed.status || 1);
} else {
  console.log("Inspect the values in Netlify, then deploy with:");
  console.log("  npm run setup:netlify -- --deploy");
  console.log("or:");
  console.log("  netlify deploy --prod --build");
}
