import { createClient } from "@supabase/supabase-js";

import { reathConfig } from "./config.mjs";

export const requireData = (result, label = "Supabase operation") => {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
};

export const getReathSupabase = (env = {}) => {
  const config = reathConfig(env);
  if (!config.configured) throw new Error(`Reath Edge runtime is not configured: ${config.errors.join("; ")}`);
  return {
    config,
    client: createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
};
