import {
  createCreativeOsHandler,
  DEFAULT_ARTIFACT_PAGE_SIZE,
  handleCreativeOs,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_BULK_ORGANIZATION_ITEMS,
  MAX_UPLOAD_BYTES,
  organizationDisposition,
  REQUIRED_STORAGE_BUCKETS,
  runSetupHealthCheck,
} from "../../src/server/creative-os/handle-creative-os.mjs";
import { bindNetlifyIdentityContext } from "./lib/netlify-identity-provider.mjs";
import { RoutedAuthProvider } from "./lib/auth-provider-router.mjs";
import { NetlifyRuntimeAdapter } from "./lib/netlify-runtime-adapter.mjs";

export {
  DEFAULT_ARTIFACT_PAGE_SIZE,
  handleCreativeOs,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_BULK_ORGANIZATION_ITEMS,
  MAX_UPLOAD_BYTES,
  organizationDisposition,
  REQUIRED_STORAGE_BUCKETS,
  runSetupHealthCheck,
};

// Compatibility entry point for the existing offline fixture suite. Production
// invokes handleCreativeOs(request, runtime) through the default export below.
export const handleCreativeOsRequest = (request, context = {}, services = {}) => {
  const runtime = services.runtime || new NetlifyRuntimeAdapter();
  const { runtime: _runtime, ...handlerServices } = services;
  bindNetlifyIdentityContext(request, context);
  return createCreativeOsHandler({
    authProvider: handlerServices.authProvider || new RoutedAuthProvider({ netlifyContext: context }),
    ...handlerServices,
  })(request, runtime);
};

export default (request, context = {}) => {
  bindNetlifyIdentityContext(request, context);
  return createCreativeOsHandler({ authProvider: new RoutedAuthProvider({ netlifyContext: context }) })(request, new NetlifyRuntimeAdapter());
};
