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

/** @implements {import("../../../src/server/auth/auth-provider.ts").AuthProvider} */
export class NetlifyAuthProvider {
  name = "netlify-identity";
  #context;
  #fetch;

  constructor({ context = {}, fetchImpl = globalThis.fetch } = {}) {
    this.#context = context;
    this.#fetch = fetchImpl;
  }

  authenticate(request, { environment } = {}) {
    return resolveIdentity(request, this.#context, this.#fetch, environment);
  }
}
