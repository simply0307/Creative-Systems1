const DEFAULT_NOW = "2026-08-09T12:00:00.000Z";

const deterministicUuid = (sequence) => `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

/** @implements {import("./runtime-adapter.ts").RuntimeAdapter} */
export class LocalTestRuntimeAdapter {
  name = "local-test";
  #environment;
  #secrets;
  #deployment;
  #now;
  #uuids;
  #uuidSequence = 0;

  constructor({ environment = {}, secrets = {}, deployment = {}, now = DEFAULT_NOW, uuids = [] } = {}) {
    this.#environment = { ...environment };
    this.#secrets = { ...secrets };
    this.#deployment = {
      branch: deployment.branch ?? null,
      deployId: deployment.deployId ?? null,
      commitRef: deployment.commitRef ?? null,
    };
    this.#now = typeof now === "function" ? now : () => new Date(now);
    this.#uuids = [...uuids];
  }

  getConfig(name) {
    return String(this.#environment[name] ?? "");
  }

  getSecret(name) {
    return String(this.#secrets[name] ?? this.#environment[name] ?? "");
  }

  deploymentMetadata() {
    return { ...this.#deployment };
  }

  now() {
    return new Date(this.#now().getTime());
  }

  randomUUID() {
    const supplied = this.#uuids.shift();
    if (supplied) return supplied;
    this.#uuidSequence += 1;
    return deterministicUuid(this.#uuidSequence);
  }
}
