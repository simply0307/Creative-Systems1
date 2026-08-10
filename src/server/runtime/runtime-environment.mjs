const SECRET_NAMES = new Set([
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export const runtimeEnvironment = (runtime) => new Proxy(Object.create(null), {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    return SECRET_NAMES.has(property) ? runtime.getSecret(property) : runtime.getConfig(property);
  },
});
