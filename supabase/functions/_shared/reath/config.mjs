export const REATH_PROJECT_REF = "okqkljexfzolzxysjaha";

const integer = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const secretFromJson = (value) => {
  try {
    const keys = Object.values(JSON.parse(value || "{}"));
    return keys.find((key) => typeof key === "string" && key.trim()) || "";
  } catch {
    return "";
  }
};

export const reathConfig = (env = {}) => {
  const url = String(env.SUPABASE_URL || "").trim();
  const derivedProjectRef = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i)?.[1] || "";
  const serviceRoleKey = String(
    env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_SECRET_KEY
      || secretFromJson(env.SUPABASE_SECRET_KEYS),
  ).trim();
  const errors = [];
  if (derivedProjectRef !== REATH_PROJECT_REF) errors.push("SUPABASE_URL is not the authorized Reath project");
  if (!serviceRoleKey) errors.push("A Supabase server secret is required");
  return {
    url,
    projectRef: REATH_PROJECT_REF,
    derivedProjectRef,
    serviceRoleKey,
    runtimeContext: "supabase-edge",
    allowedOrigin: "",
    userAgent: String(env.REATH_INGEST_USER_AGENT || "ReathDigestNewsIngester/1.0 (editorial metadata collector)"),
    fetchTimeoutMs: integer(env.REATH_FETCH_TIMEOUT_MS, 8_000, 1_000, 15_000),
    maxFeedBytes: integer(env.REATH_MAX_FEED_BYTES, 2_000_000, 100_000, 5_000_000),
    aiEnabled: false,
    aiAvailable: false,
    aiUnavailableReason: "disabled_in_supabase_ingestion_worker",
    configured: errors.length === 0,
    errors,
  };
};
