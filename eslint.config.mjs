const sharedGlobals = {
  AbortController: "readonly", crypto: "readonly", CustomEvent: "readonly", Deno: "readonly", FormData: "readonly", Map: "readonly", Netlify: "readonly",
  Option: "readonly", Promise: "readonly", Request: "readonly", Response: "readonly", TextDecoder: "readonly", TextEncoder: "readonly", URL: "readonly", URLSearchParams: "readonly",
  clearTimeout: "readonly", console: "readonly", document: "readonly", fetch: "readonly", globalThis: "readonly",
  process: "readonly", setTimeout: "readonly", structuredClone: "readonly", window: "readonly",
};

export default [{
  files: ["netlify/reath-functions/**/*.mts", "netlify/functions/_shared/reath/**/*.mjs", "netlify/functions/reath-*.mjs", "supabase/functions/**/*.mjs", "src/scripts/reath-*.js", "scripts/*reath*.mjs", "scripts/generate-nj-geography.mjs"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: sharedGlobals },
  rules: {
    "no-constant-condition": "error",
    "no-duplicate-imports": "error",
    "no-undef": "error",
    "no-unreachable": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
  },
}];
