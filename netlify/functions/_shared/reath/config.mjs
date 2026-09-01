import { CANONICAL_SUPABASE_PROJECT_REF, deriveSupabaseProjectRef } from "../../lib/runtime-contract.mjs";

export const REATH_PROJECT_REF = CANONICAL_SUPABASE_PROJECT_REF;

export const envValue = (name, env = process.env) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || env[name] || "";
  } catch {
    return env[name] || "";
  }
};

const integer = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const enabled = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());

export const reathConfig = (env = process.env) => {
  const url = envValue("SUPABASE_URL", env);
  const projectRef = envValue("SUPABASE_PROJECT_REF", env);
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env) || envValue("SUPABASE_SECRET_KEY", env);
  const runtimeContext = envValue("REATH_RUNTIME_CONTEXT", env);
  const allowedOrigin = envValue("REATH_ALLOWED_ORIGIN", env);
  const aiEnabled = enabled(envValue("REATH_AI_ENABLED", env));
  const aiProvider = (envValue("REATH_AI_PROVIDER", env) || "openai").trim().toLowerCase();
  const aiCredentialAvailable = Boolean(envValue("OPENAI_API_KEY", env));
  const derivedProjectRef = deriveSupabaseProjectRef(url);
  const errors = [];
  if (!url) errors.push("SUPABASE_URL is required");
  if (url && !derivedProjectRef) errors.push("SUPABASE_URL must be the authorized HTTPS Supabase project URL");
  if (!projectRef) errors.push("SUPABASE_PROJECT_REF is required");
  if (projectRef && projectRef !== REATH_PROJECT_REF) errors.push("SUPABASE_PROJECT_REF is not the authorized Reath project");
  if (derivedProjectRef && derivedProjectRef !== projectRef) errors.push("SUPABASE_URL and SUPABASE_PROJECT_REF do not match");
  if (!serviceRoleKey) errors.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required");
  if (!runtimeContext) errors.push("REATH_RUNTIME_CONTEXT is required");
  if (runtimeContext === "production" && !allowedOrigin) errors.push("REATH_ALLOWED_ORIGIN is required in production");
  return {
    url,
    projectRef,
    derivedProjectRef,
    serviceRoleKey,
    runtimeContext,
    allowedOrigin,
    userAgent: envValue("REATH_INGEST_USER_AGENT", env) || "ReathDigestNewsIngester/1.0 (editorial metadata collector)",
    fetchTimeoutMs: integer(envValue("REATH_FETCH_TIMEOUT_MS", env), 8000, 1000, 20000),
    maxFeedBytes: integer(envValue("REATH_MAX_FEED_BYTES", env), 2_000_000, 100_000, 10_000_000),
    aiEnabled,
    aiProvider,
    aiModel: envValue("REATH_AI_MODEL", env) || "gpt-5-mini",
    aiMaxStoriesPerRun: integer(envValue("REATH_AI_MAX_STORIES_PER_RUN", env), 10, 0, 50),
    aiTimeoutMs: integer(envValue("REATH_AI_TIMEOUT_MS", env), 40_000, 1_000, 55_000),
    aiEnrichmentVersion: envValue("REATH_AI_ENRICHMENT_VERSION", env) || "1",
    aiCredentialAvailable,
    aiAvailable: aiEnabled && aiProvider === "openai" && aiCredentialAvailable,
    aiUnavailableReason: !aiEnabled ? "disabled" : aiProvider !== "openai" ? "unsupported_provider" : !aiCredentialAvailable ? "missing_server_credentials" : null,
    configured: errors.length === 0,
    errors,
  };
};
