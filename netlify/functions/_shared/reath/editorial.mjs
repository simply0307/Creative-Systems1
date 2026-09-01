export const EDITORIAL_STATUSES = ["new", "watch", "keep", "ignore"];
export const EDITORIAL_ROUTES = ["digest", "civic_relay", "funnies", "longform"];

export const validateEditorialChange = ({ status, route = null, notes = "", reason = "" }) => {
  if (!EDITORIAL_STATUSES.includes(status)) throw new Error(`Invalid editorial status: ${status}`);
  if (route !== null && !EDITORIAL_ROUTES.includes(route)) throw new Error(`Invalid editorial route: ${route}`);
  return { status, route, notes: String(notes || "").slice(0, 5000), reason: String(reason || "").slice(0, 2000) };
};
