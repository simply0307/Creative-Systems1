import { normalizedSourceItem, parseFeed, plainText } from "./feed-parser.mjs";

const valueAt = (object, path) => String(path || "").split(".").filter(Boolean).reduce((value, part) => value?.[part], object);
const firstArray = (payload, configuredPath) => {
  const configured = configuredPath ? valueAt(payload, configuredPath) : null;
  if (Array.isArray(configured)) return configured;
  for (const path of ["items", "results", "data", "entries"]) {
    const value = valueAt(payload, path);
    if (Array.isArray(value)) return value;
  }
  throw new Error("API payload has no configured item array");
};

const field = (item, fields, name, fallbacks) => {
  const configured = fields?.[name] ? valueAt(item, fields[name]) : undefined;
  if (configured != null) return configured;
  for (const fallback of fallbacks) {
    const value = valueAt(item, fallback);
    if (value != null) return value;
  }
  return null;
};

export const parseApiPayload = (body, { feedUrl, publisher, adapterConfig = {} }) => {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`API response is not valid JSON: ${error.message}`);
  }
  const fields = adapterConfig.fields || {};
  const feedTitle = plainText(adapterConfig.feedTitle || payload.title || publisher, 300);
  return firstArray(payload, adapterConfig.itemsPath).slice(0, 500).map((item) => normalizedSourceItem({
    feedType: "api",
    feedTitle,
    feedUrl,
    publisher,
    item: {
      title: field(item, fields, "headline", ["title", "headline", "name"]),
      url: field(item, fields, "url", ["url", "external_url", "link"]),
      guid: field(item, fields, "guid", ["id", "guid", "uuid"]),
      description: field(item, fields, "description", ["summary", "description", "excerpt"]),
      author: field(item, fields, "author", ["author.name", "author", "byline"]),
      published_at: field(item, fields, "publishedAt", ["date_published", "published_at", "published", "created_at"]),
      category: field(item, fields, "categories", ["tags", "categories"]),
    },
  })).filter(Boolean);
};

const normalizedRules = (value) => (Array.isArray(value) ? value : [])
  .map((rule) => String(rule || "").trim().toLowerCase())
  .filter(Boolean)
  .slice(0, 50);

export const filterConfiguredItems = (items, adapterConfig = {}) => {
  const includedCategories = normalizedRules(adapterConfig.include_categories);
  const includedAuthors = normalizedRules(adapterConfig.include_author_patterns);
  const includedUrls = normalizedRules(adapterConfig.include_url_patterns);
  const excludedCategories = normalizedRules(adapterConfig.exclude_categories);
  const excludedAuthors = normalizedRules(adapterConfig.exclude_author_patterns);
  const excludedTitles = normalizedRules(adapterConfig.exclude_title_patterns);
  const excludedUrls = normalizedRules(adapterConfig.exclude_url_patterns);
  if (!includedCategories.length && !includedAuthors.length && !includedUrls.length
    && !excludedCategories.length && !excludedAuthors.length && !excludedTitles.length && !excludedUrls.length) return items;
  return items.filter((item) => {
    const title = String(item.headline || "").toLowerCase();
    const url = String(item.canonicalUrl || item.url || "").toLowerCase();
    const author = String(item.author || "").toLowerCase();
    const categories = (item.rawMetadata?.categories || []).map((category) => String(category || "").toLowerCase());
    if (includedCategories.length
      && !includedCategories.some((rule) => categories.some((category) => category.includes(rule)))) return false;
    if (includedAuthors.length && !includedAuthors.some((rule) => author.includes(rule))) return false;
    if (includedUrls.length && !includedUrls.some((rule) => url.includes(rule))) return false;
    if (excludedAuthors.some((rule) => author.includes(rule))) return false;
    if (excludedTitles.some((rule) => title.includes(rule))) return false;
    if (excludedUrls.some((rule) => url.includes(rule))) return false;
    return !excludedCategories.some((rule) => categories.some((category) => category.includes(rule)));
  });
};

export const parseSourcePayload = (source, body) => {
  const options = { feedUrl: source.feed_url, publisher: source.name };
  let items;
  if (source.ingestion_method === "api") items = parseApiPayload(body, { ...options, adapterConfig: source.adapter_config || {} });
  else if (source.ingestion_method === "rss" || source.ingestion_method === "atom") items = parseFeed(body, options);
  else throw new Error(`Unsupported ingestion method: ${source.ingestion_method}`);
  return filterConfiguredItems(items, source.adapter_config || {});
};
