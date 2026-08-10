const DATABASE_MUTATIONS = new Set(["delete", "insert", "rpc", "update", "upsert"]);

const createCounters = () => ({
  active: { auth: 0, database: 0, storage: 0, total: 0 },
  maximum: { auth: 0, database: 0, storage: 0, total: 0 },
});

export const createRequestBudgetRecorder = () => {
  const records = [];
  const counters = createCounters();

  const measure = async (operation, run) => {
    const record = {
      kind: operation.kind,
      operation: operation.operation,
      table: operation.table || null,
      bucket: operation.bucket || null,
      mutation: operation.mutation ?? (operation.kind === "database" && DATABASE_MUTATIONS.has(operation.operation)),
    };
    records.push(record);
    counters.active[operation.kind] += 1;
    counters.active.total += 1;
    counters.maximum[operation.kind] = Math.max(counters.maximum[operation.kind], counters.active[operation.kind]);
    counters.maximum.total = Math.max(counters.maximum.total, counters.active.total);
    try {
      return await run();
    } finally {
      counters.active[operation.kind] -= 1;
      counters.active.total -= 1;
    }
  };

  const snapshot = () => {
    const count = (predicate) => records.filter(predicate).length;
    const databaseRequests = count((record) => record.kind === "database");
    const storageRequests = count((record) => record.kind === "storage");
    const authVerificationRequests = count((record) => record.kind === "auth");
    return {
      databaseRequests,
      storageRequests,
      storageSigningRequests: count((record) => record.kind === "storage" && ["createSignedUrl", "createSignedUrls"].includes(record.operation)),
      authVerificationRequests,
      externalSubrequests: databaseRequests + storageRequests + authVerificationRequests,
      mutationRequests: count((record) => record.mutation),
      maximumConcurrent: { ...counters.maximum },
      byDatabaseTable: Object.fromEntries([...new Set(records.filter((record) => record.table).map((record) => record.table))]
        .sort()
        .map((table) => [table, count((record) => record.table === table)])),
      byOperation: Object.fromEntries([...new Set(records.map((record) => `${record.kind}.${record.operation}`))]
        .sort()
        .map((key) => [key, count((record) => `${record.kind}.${record.operation}` === key)])),
    };
  };

  return { measure, records, snapshot };
};

const wrapQueryBuilder = (builder, recorder, metadata) => new Proxy(builder, {
  get(target, property, receiver) {
    if (property === "then") {
      return (resolve, reject) => recorder
        .measure(metadata, () => Promise.resolve(target))
        .then(resolve, reject);
    }
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (DATABASE_MUTATIONS.has(String(property))) metadata.operation = String(property);
      const result = value.apply(target, args);
      if (!result || typeof result !== "object") return result;
      if (result instanceof Promise) return recorder.measure(metadata, () => result);
      return wrapQueryBuilder(result, recorder, metadata);
    };
  },
});

export const instrumentSupabaseClient = (client, recorder) => new Proxy(client, {
  get(target, property, receiver) {
    if (property === "from") {
      return (table) => wrapQueryBuilder(target.from(table), recorder, {
        kind: "database",
        operation: "select",
        table,
      });
    }
    if (property === "rpc") {
      return (name, ...args) => recorder.measure({
        kind: "database",
        operation: "rpc",
        table: `rpc:${name}`,
        mutation: name === "creative_os_bulk_organize_artifacts",
      }, () => target.rpc(name, ...args));
    }
    if (property === "storage") {
      return new Proxy(target.storage, {
        get(storageTarget, storageProperty, storageReceiver) {
          if (storageProperty === "listBuckets") {
            return (...args) => recorder.measure({ kind: "storage", operation: "listBuckets" }, () => storageTarget.listBuckets(...args));
          }
          if (storageProperty === "from") {
            return (bucket) => {
              const bucketClient = storageTarget.from(bucket);
              return new Proxy(bucketClient, {
                get(bucketTarget, bucketProperty, bucketReceiver) {
                  const bucketValue = Reflect.get(bucketTarget, bucketProperty, bucketReceiver);
                  if (typeof bucketValue !== "function") return bucketValue;
                  return (...args) => recorder.measure({
                    kind: "storage",
                    operation: String(bucketProperty),
                    bucket,
                  }, () => bucketValue.apply(bucketTarget, args));
                },
              });
            };
          }
          return Reflect.get(storageTarget, storageProperty, storageReceiver);
        },
      });
    }
    return Reflect.get(target, property, receiver);
  },
});

export const instrumentAuthFetch = (fetchImplementation, recorder) => (...args) => recorder.measure({
  kind: "auth",
  operation: "verifyIdentity",
}, () => fetchImplementation(...args));

export const assertFixtureOnlyBudget = (value) => {
  if (value?.fixtureOnly !== true || value?.networkRequests !== 0) {
    throw new Error("Request-budget measurement must use the offline fixture client and make zero network requests.");
  }
};
