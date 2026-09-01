import { createClient } from "@supabase/supabase-js";
import { reathConfig } from "./config.mjs";

export const requireData = (result, label = "Supabase operation") => {
  if (result.error) {
    const error = new Error(`${label}: ${result.error.message}`);
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }
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
