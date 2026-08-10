// Test-only acceptance targets for the planned Cloudflare Worker migration.
// Keep provider limits isolated here; do not import them into business logic.
export const WORKER_FREE_REQUEST_BUDGET = Object.freeze({
  externalSubrequests: 50,
  simultaneousOutgoingConnections: 6,
});
