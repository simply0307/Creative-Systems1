import { resolveIdentity } from "./identity.mjs";

const identityContexts = new WeakMap();

export const bindNetlifyIdentityContext = (request, context = {}) => {
  if (request && (typeof request === "object" || typeof request === "function")) identityContexts.set(request, context || {});
  return request;
};

export const resolveNetlifyIdentity = (request, environment) => resolveIdentity(
  request,
  identityContexts.get(request) || {},
  globalThis.fetch,
  environment,
);
