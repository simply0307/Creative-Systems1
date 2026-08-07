import process from "node:process";
import { supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import {
  REQUIRED_SUPABASE_ENV,
  loadLocalEnv,
  maskSecrets,
  readNetlifySiteId,
  resolveCommand,
  runCommand,
} from "./lib/setup-utils.mjs";

loadLocalEnv();

const requestedContext = process.argv.find((argument) => argument.startsWith("--context="))?.slice(10) || "";
const allowedContexts = new Set(["production", "deploy-preview", "branch-deploy"]);
if (!allowedContexts.has(requestedContext)) {
  console.error("Choose one explicit Netlify context: --context=production, --context=deploy-preview, or --context=branch-deploy.");
  process.exit(1);
}

const config = supabaseConfig(process.env);
if (!config.configured) {
  console.error(`Cannot configure Netlify. Runtime configuration is invalid: ${[...config.missing, ...config.configurationErrors.map((item) => item.code)].join(", ")}.`);
  process.exit(1);
}
if (config.runtimeContext !== requestedContext) {
  console.error(`CREATIVE_OS_RUNTIME_CONTEXT=${config.runtimeContext} does not match requested Netlify context ${requestedContext}.`);
  process.exit(1);
}

const cli = resolveCommand("netlify");
if (!cli) {
  console.error("Netlify CLI is missing. Install it with: npm install --save-dev netlify-cli");
  console.error("Then run: netlify login && netlify link && npm run setup:netlify -- --context=production");
  process.exit(1);
}

const siteId = readNetlifySiteId();
if (!siteId) {
  console.error("No linked Netlify site was found. Run `netlify login` and `netlify link`, or add NETLIFY_SITE_ID to .env.");
  process.exit(1);
}

console.log(`Setting Creative OS runtime variables only for Netlify context ${requestedContext}â€¦`);
for (const name of REQUIRED_SUPABASE_ENV) {
  const args = ["env:set", name, process.env[name], "--site", siteId, "--context", requestedContext];
  if (name === "SUPABASE_SERVICE_ROLE_KEY") args.push("--secret");
  const result = runCommand(cli, args, { print: false });
  const output = maskSecrets(`${result.stdout || ""}${result.stderr || ""}`);
  if (result.status !== 0) {
    console.error(`Failed to set ${name} for ${requestedContext}. ${output.trim()}`);
    process.exit(1);
  }
  console.log(`Set ${name} for ${requestedContext} (value hidden).`);
}

console.log("\nContext-scoped Netlify variables are configured. Other contexts were not changed.");
if (process.argv.includes("--deploy")) {
  if (requestedContext !== "production") {
    console.error("This setup command only supports an explicit production deploy. Use the normal Git preview flow for preview contexts.");
    process.exit(1);
  }
  console.log("Running the explicitly requested production build and deployâ€¦");
  const deployed = runCommand(cli, ["deploy", "--prod", "--build", "--site", siteId], { capture: false });
  if (deployed.status !== 0) process.exit(deployed.status || 1);
} else {
  console.log("No deploy was performed. Review the context-scoped values before a separately authorized deploy.");
}
