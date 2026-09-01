import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourceUrl = "https://maps.nj.gov/arcgis/rest/services/Framework/Government_Boundaries/MapServer/2/query?where=1%3D1&outFields=MUN%2CCOUNTY%2CMUN_LABEL%2CMUN_TYPE%2CNAME%2CGNIS%2CMUN_CODE%2CSSN%2CCENSUS2020&returnGeometry=false&f=json";
const expectedRows = 564;
const startMarker = "-- GENERATED_MUNICIPALITY_SEED_START";
const endMarker = "-- GENERATED_MUNICIPALITY_SEED_END";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(scriptDir, "../supabase/migrations/20260822031655_convert_creative_os_to_reath_digest.sql");

const countyIds = new Map([
  ["ATLANTIC", 1], ["BERGEN", 2], ["BURLINGTON", 3], ["CAMDEN", 4],
  ["CAPE MAY", 5], ["CUMBERLAND", 6], ["ESSEX", 7], ["GLOUCESTER", 8],
  ["HUDSON", 9], ["HUNTERDON", 10], ["MERCER", 11], ["MIDDLESEX", 12],
  ["MONMOUTH", 13], ["MORRIS", 14], ["OCEAN", 15], ["PASSAIC", 16],
  ["SALEM", 17], ["SOMERSET", 18], ["SUSSEX", 19], ["UNION", 20], ["WARREN", 21],
]);

const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const slugify = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const municipalityType = (value) => {
  const normalized = String(value || "").toLowerCase();
  return ["borough", "city", "town", "township", "village"].includes(normalized) ? normalized : "other";
};
const pgArray = (values) => `array[${[...new Set(values.filter(Boolean))].map(sql).join(", ")}]::text[]`;

const response = await fetch(sourceUrl, { headers: { "User-Agent": "ReathDigestGeographyGenerator/1.0" } });
if (!response.ok) throw new Error(`NJGIN geography request failed: ${response.status}`);
const payload = await response.json();
if (payload.error) throw new Error(`NJGIN geography error: ${payload.error.message}`);
if (payload.features?.length !== expectedRows) {
  throw new Error(`Expected ${expectedRows} NJ municipalities, received ${payload.features?.length ?? 0}`);
}

const rows = payload.features.map(({ attributes }) => {
  const countyId = countyIds.get(String(attributes.COUNTY).toUpperCase());
  if (!countyId) throw new Error(`Unknown NJ county: ${attributes.COUNTY}`);
  const name = String(attributes.MUN_LABEL || attributes.NAME).trim();
  const aliases = [String(attributes.NAME || "").trim(), String(attributes.MUN || "").trim()];
  return {
    countyId,
    name,
    slug: slugify(name),
    type: municipalityType(attributes.MUN_TYPE),
    aliases,
    treasuryCode: String(attributes.MUN_CODE).padStart(4, "0"),
    censusGeoid: String(attributes.CENSUS2020),
    gnisCode: String(attributes.GNIS || "").trim(),
    localCode: String(attributes.SSN || "").trim(),
  };
}).sort((a, b) => a.countyId - b.countyId || a.name.localeCompare(b.name));

const duplicate = (key) => rows.find((row, index) => rows.findIndex((candidate) => candidate[key] === row[key]) !== index)?.[key];
if (duplicate("treasuryCode")) throw new Error(`Duplicate treasury code: ${duplicate("treasuryCode")}`);
if (duplicate("censusGeoid")) throw new Error(`Duplicate census GEOID: ${duplicate("censusGeoid")}`);

const values = rows.map((row) => `  (${row.countyId}, ${sql(row.name)}, ${sql(row.slug)}, ${sql(row.type)}, ${pgArray(row.aliases)}, ${sql(row.treasuryCode)}, ${sql(row.censusGeoid)}, ${sql(row.gnisCode)}, ${sql(row.localCode)})`);
const generated = [
  startMarker,
  `-- Generated from NJGIN Municipalities MapServer/2 (${sourceUrl}).`,
  `-- Expected/current row count: ${expectedRows}. Do not hand-edit this block.`,
  "insert into public.municipalities (county_id, name, slug, municipality_type, aliases, treasury_code, census_geoid, gnis_code, local_code) values",
  `${values.join(",\n")};`,
  endMarker,
].join("\n");

const migration = await readFile(migrationPath, "utf8");
const start = migration.indexOf(startMarker);
const end = migration.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("Municipality seed markers are missing or out of order");
const updated = `${migration.slice(0, start)}${generated}${migration.slice(end + endMarker.length)}`;
await writeFile(migrationPath, updated, "utf8");
console.log(`Wrote ${rows.length} official NJ municipality rows to ${migrationPath}`);
