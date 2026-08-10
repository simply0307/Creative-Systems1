import { randomUUID } from "node:crypto";

const readNetlifyEnvironment = (name, fallback) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || fallback[name] || "";
  } catch {
    return fallback[name] || "";
  }
};

/** @implements {import("../../../src/server/runtime/runtime-adapter.ts").RuntimeAdapter} */
export class NetlifyRuntimeAdapter {
  name = "netlify-functions";
  #environment;

  constructor({ environment = process.env } = {}) {
    this.#environment = environment;
  }

  getConfig(name) {
    return readNetlifyEnvironment(name, this.#environment);
  }

  getSecret(name) {
    return readNetlifyEnvironment(name, this.#environment);
  }

  deploymentMetadata() {
    return {
      branch: this.getConfig("BRANCH") || this.getConfig("HEAD") || null,
      deployId: this.getConfig("DEPLOY_ID") || null,
      commitRef: this.getConfig("COMMIT_REF") || null,
    };
  }

  now() {
    return new Date();
  }

  randomUUID() {
    return randomUUID();
  }
}
