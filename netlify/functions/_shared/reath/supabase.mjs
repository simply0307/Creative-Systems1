import { createClient } from "@supabase/supabase-js";
import { reathConfig } from "./config.mjs";

const TRANSIENT_UPSTREAM_PATTERN = /<!doctype\s+html|<html\b|cloudflare|web server is down|server lacks jwt secret|bad gateway|gateway timeout|fetch failed|failed to fetch|upstream connect|error\s*52[0-9]/i;
const TRANSIENT_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const boundedMessage = (value, maximum = 400) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);

export const normalizeSupabaseError = (result, label = "Supabase operation") => {
  const source = result?.error || {};
  const rawMessage = boundedMessage(source.message);
  const upstreamStatus = Number(result?.status || source.status || 0);
  const transient = TRANSIENT_STATUS.has(upstreamStatus) || TRANSIENT_UPSTREAM_PATTERN.test(rawMessage);
  const error = new Error(transient
    ? `${label}: Reath's data service is temporarily unavailable.`
    : `${label}: ${rawMessage || "The database request failed."}`);
  error.code = source.code || (transient ? "REATH_UPSTREAM_UNAVAILABLE" : "REATH_DATABASE_ERROR");
  error.status = transient ? 503 : undefined;
  error.upstreamStatus = upstreamStatus || undefined;
  error.diagnostic = {
    kind: transient ? "upstream_unavailable" : "database_error",
    code: error.code,
    upstreamStatus: error.upstreamStatus,
  };
  return error;
};

export const requireData = (result, label = "Supabase operation") => {
  if (result.error) throw normalizeSupabaseError(result, label);
  return result.data;
};

export const getReathSupabase = (env = process.env) => {
  const config = reathConfig(env);
  if (!config.configured) throw new Error(`Reath Supabase is not configured: ${config.errors.join("; ")}`);
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, config };
};
