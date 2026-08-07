import process from "node:process";
import { loadLocalEnv, runNodeScript } from "./lib/setup-utils.mjs";

loadLocalEnv();

const steps = [
  ["Prerequisite check", "scripts/setup-check.mjs", []],
  ["Supabase preparation", "scripts/setup-supabase.mjs", []],
  ["Netlify environment setup", "scripts/setup-netlify.mjs", [`--context=${process.env.CREATIVE_OS_RUNTIME_CONTEXT || ""}`]],
  ["Dry import report", "scripts/setup-import.mjs", []],
];

console.log("Creative OS guided setup\n");
const outcomes = [];
for (const [label, script, args] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = runNodeScript(script, args, { capture: false });
  outcomes.push({ label, ok: result.status === 0 });
  if (label === "Prerequisite check" && result.status !== 0) {
    console.error("\nPrerequisites are incomplete. Fix the reported items, then rerun npm run setup.");
    process.exit(result.status || 1);
  }
}

console.log("\n=== Guided setup paused safely ===");
console.log("No real metadata/file import was run.");
console.log("Inspect the dry-run counts above. When ready, run: npm run setup:import:apply");
console.log("After importing and redeploying, run: npm run setup:verify -- --url=https://YOUR-SITE.netlify.app");
if (outcomes.some((item) => !item.ok)) {
  console.log("One or more automated steps needs the manual fallback shown above before live verification.");
  process.exitCode = 1;
}
