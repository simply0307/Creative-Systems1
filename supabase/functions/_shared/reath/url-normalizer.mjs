const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "ref", "referrer", "source",
  "mc_cid", "mc_eid", "oly_anon_id", "oly_enc_id",
]);

export const normalizeUrl = (value, baseUrl) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMS.has(normalized)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
};

export const sameCanonicalUrl = (left, right) => normalizeUrl(left) === normalizeUrl(right);
