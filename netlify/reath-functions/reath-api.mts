export { default } from "../functions/reath-api.mjs";

// Netlify requires route and bundler metadata to be a static config object in
// the function entrypoint. It does not detect re-exported configuration.
export const config = {
  path: [
    "/api/reath/me",
    "/api/reath/stories",
    "/api/reath/stories/:id",
    "/api/reath/stories/:id/editorial",
    "/api/reath/stories/:id/ai/enrich",
    "/api/reath/stories/:id/ai/analyze",
    "/api/reath/stories/:id/sources/:sourceItemId/detach",
    "/api/reath/stories/merge",
    "/api/reath/sources/health",
    "/api/reath/runs",
    "/api/reath/ai/capability",
    "/api/reath/ai/activity",
    "/api/reath/ingest",
  ],
};
