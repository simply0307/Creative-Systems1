const normalized = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const includesTerm = (haystack, term) => term.length >= 3 && (` ${haystack} `).includes(` ${term} `);

export const matchGeography = (value, counties = [], municipalities = [], source = {}) => {
  const haystack = normalized(value);
  const countyMatches = counties.filter((county) => includesTerm(haystack, normalized(`${county.name} county`)) || includesTerm(haystack, normalized(county.name)));
  if (source.county_id && !countyMatches.some((county) => county.id === source.county_id)) {
    const sourceCounty = counties.find((county) => county.id === source.county_id);
    if (sourceCounty) countyMatches.push(sourceCounty);
  }
  const countyIds = new Set(countyMatches.map((county) => county.id));

  const rawMunicipalityMatches = municipalities.filter((municipality) => {
    const terms = [municipality.name, ...(municipality.aliases || [])].map(normalized).filter(Boolean);
    return terms.some((term) => includesTerm(haystack, term));
  });
  const byTerm = new Map();
  for (const municipality of rawMunicipalityMatches) {
    const key = normalized(municipality.aliases?.[0] || municipality.name);
    byTerm.set(key, [...(byTerm.get(key) || []), municipality]);
  }
  const municipalityMatches = rawMunicipalityMatches.filter((municipality) => {
    const key = normalized(municipality.aliases?.[0] || municipality.name);
    const ambiguous = (byTerm.get(key) || []).length > 1;
    return !ambiguous || countyIds.has(municipality.county_id) || source.municipality_id === municipality.id;
  });
  for (const municipality of municipalityMatches) countyIds.add(municipality.county_id);

  return {
    counties: counties.filter((county) => countyIds.has(county.id)),
    municipalities: municipalityMatches,
  };
};

export const geographyOverlap = (left = {}, right = {}) => {
  const a = new Set([...(left.countyIds || []), ...(left.municipalityIds || [])]);
  const b = new Set([...(right.countyIds || []), ...(right.municipalityIds || [])]);
  if (!a.size || !b.size) return 0;
  return [...a].some((value) => b.has(value)) ? 1 : 0;
};
