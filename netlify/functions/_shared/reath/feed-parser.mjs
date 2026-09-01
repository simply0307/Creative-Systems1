import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { normalizeHeadline } from "./headline.mjs";
import { normalizeUrl } from "./url-normalizer.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: true,
  processEntities: true,
});

const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return text(value["#text"] ?? value["@href"] ?? value["@url"] ?? "");
};
const decodeEntities = (value) => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

export const plainText = (value, limit = 4000) => decodeEntities(String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

const validDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const atomLink = (entry) => {
  const links = array(entry.link);
  const alternate = links.find((link) => !link?.["@rel"] || link?.["@rel"] === "alternate");
  return text(alternate || links[0]);
};

const categories = (item) => array(item.category).map((category) => text(category?.["@term"] || category)).filter(Boolean).slice(0, 20);

export const normalizedSourceItem = ({ item, feedType, feedTitle, feedUrl, publisher }) => {
  const isAtom = feedType === "atom";
  const headline = plainText(text(item.title), 500);
  const sourceUrl = isAtom ? atomLink(item) : text(item.url || item.link || item.guid);
  const canonicalUrl = normalizeUrl(sourceUrl, feedUrl);
  if (!headline || !canonicalUrl) return null;
  const description = plainText(isAtom ? text(item.summary || item.description) : text(item.description || item.summary), 1500);
  const externalGuid = plainText(text(isAtom ? item.id : item.guid), 1000) || canonicalUrl;
  const author = plainText(text(item.author?.name || item.author || item["dc:creator"]), 300) || null;
  const publishedAt = validDate(text(item.published || item.published_at || item.updated || item.pubDate || item["dc:date"]));
  const normalized = normalizeHeadline(headline);
  const contentHash = createHash("sha256").update(`${normalized}\n${description}\n${canonicalUrl}`).digest("hex");
  return {
    externalGuid,
    url: canonicalUrl,
    canonicalUrl,
    headline,
    normalizedHeadline: normalized,
    description,
    author,
    publisher,
    publishedAt,
    contentHash,
    rawMetadata: {
      feedType,
      feedTitle,
      categories: categories(item),
      language: plainText(text(item.language), 50) || null,
      // Full content fields are intentionally excluded for publisher-rights safety.
    },
  };
};

export const parseFeed = (xml, { feedUrl, publisher }) => {
  if (!String(xml || "").trim()) throw new Error("Feed response is empty");
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    throw new Error(`Feed XML is invalid: ${error.message}`);
  }
  if (parsed.rss?.channel) {
    const channel = parsed.rss.channel;
    const feedTitle = plainText(text(channel.title), 300) || publisher;
    return array(channel.item).map((item) => normalizedSourceItem({ item, feedType: "rss", feedTitle, feedUrl, publisher })).filter(Boolean);
  }
  if (parsed.feed) {
    const feedTitle = plainText(text(parsed.feed.title), 300) || publisher;
    return array(parsed.feed.entry).map((item) => normalizedSourceItem({ item, feedType: "atom", feedTitle, feedUrl, publisher })).filter(Boolean);
  }
  throw new Error("Unsupported feed format; expected RSS or Atom");
};
