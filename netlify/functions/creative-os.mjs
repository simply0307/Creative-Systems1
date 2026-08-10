import {
  createCreativeOsHandler,
  handleCreativeOs,
  organizationDisposition,
  REQUIRED_STORAGE_BUCKETS,
  runSetupHealthCheck,
} from "../../src/server/creative-os/handle-creative-os.mjs";
import { bindNetlifyIdentityContext } from "./lib/netlify-identity-provider.mjs";
import { NetlifyRuntimeAdapter } from "./lib/netlify-runtime-adapter.mjs";

export { handleCreativeOs, organizationDisposition, REQUIRED_STORAGE_BUCKETS, runSetupHealthCheck };

// Compatibility entry point for the existing offline fixture suite. Production
// invokes handleCreativeOs(request, runtime) through the default export below.
export const handleCreativeOsRequest = (request, context = {}, services = {}) => {
  const runtime = services.runtime || new NetlifyRuntimeAdapter();
  const { runtime: _runtime, ...handlerServices } = services;
  bindNetlifyIdentityContext(request, context);
  return createCreativeOsHandler(handlerServices)(request, runtime);
};

export default (request, context = {}) => {
  bindNetlifyIdentityContext(request, context);
  return handleCreativeOs(request, new NetlifyRuntimeAdapter());
};
