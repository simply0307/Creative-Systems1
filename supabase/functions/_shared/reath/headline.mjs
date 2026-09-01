const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it",
  "new", "of", "on", "or", "that", "the", "this", "to", "was", "will", "with", "nj", "jersey",
]);

export const normalizeHeadline = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[’‘]/g, "'")
  .replace(/[–—]/g, "-")
  .toLowerCase()
  .replace(/\b(live updates?|breaking|update|photos?|video|opinion)\b\s*:?/g, " ")
  .replace(/\bnj\b/g, " ")
  .replace(/\blate[- ]night\b/g, " overnight ")
  .replace(/\b(votes?|voted|approvals?|approves?|approved)\b/g, " approve ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

export const headlineTokens = (value) => normalizeHeadline(value)
  .split(" ")
  .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

export const tokenSimilarity = (left, right) => {
  const a = new Set(headlineTokens(left));
  const b = new Set(headlineTokens(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(a.size, b.size);
  return Number((jaccard * 0.55 + containment * 0.45).toFixed(3));
};

export const keyPhrases = (value) => {
  const tokens = headlineTokens(value);
  return [...new Set(tokens.flatMap((token, index) => {
    const next = tokens[index + 1];
    return next ? [token, `${token} ${next}`] : [token];
  }))];
};

const MONEY_SCALE = new Map([
  ["k", 1_000],
  ["m", 1_000_000],
  ["b", 1_000_000_000],
  ["thousand", 1_000],
  ["million", 1_000_000],
  ["billion", 1_000_000_000],
]);
const MONEY_PATTERN = /(?:\$\s*([\d,.]+)\s*(thousand|million|billion|[kmb])?\b|\b([\d,.]+)\s+(thousand|million|billion)\b)/gi;
const FUNDING_ACTION_PATTERN = /\b(?:appropriat(?:e|es|ed|ion|ions)|approv(?:e|es|ed|al)|arrang(?:e|es|ed|ing)|award(?:s|ed)?|financ(?:e|es|ed|ing)|fund(?:s|ed|ing)?|grants?|lands?|secur(?:e|es|ed)|subsid(?:y|ies)|support(?:s|ed)?|tax credits?)\b/i;
const PROJECT_ANCHOR_STOP_WORDS = new Set([
  "approve", "approved", "award", "awarded", "billion", "credit", "credits", "fund", "funded",
  "funding", "grant", "grants", "lands", "million", "project", "record", "restoration", "renovation",
  "secure", "secured", "state", "support", "supported", "tax", "thousand",
]);

export const monetaryAmounts = (value) => [...String(value || "").matchAll(MONEY_PATTERN)]
  .map((match) => {
    const number = Number(String(match[1] || match[3] || "").replaceAll(",", ""));
    const scale = MONEY_SCALE.get(String(match[2] || match[4] || "").toLowerCase()) || 1;
    return Number.isFinite(number) && number > 0 ? Math.round(number * scale) : null;
  })
  .filter((amount) => amount !== null);

const projectAnchors = (value) => keyPhrases(value).filter((phrase) => {
  const tokens = phrase.split(" ");
  return tokens.length === 2
    && tokens.every((token) => !PROJECT_ANCHOR_STOP_WORDS.has(token) && !/^\d+$/.test(token));
});

export const fundingProjectMatch = (left, right) => {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const rightAmounts = new Set(monetaryAmounts(rightText));
  const amount = monetaryAmounts(leftText).find((value) => rightAmounts.has(value)) || null;
  const rightAnchors = new Set(projectAnchors(rightText));
  const anchor = projectAnchors(leftText).find((value) => rightAnchors.has(value)) || null;
  return {
    aligned: Boolean(amount && anchor && FUNDING_ACTION_PATTERN.test(leftText) && FUNDING_ACTION_PATTERN.test(rightText)),
    amount,
    anchor,
  };
};

// These terms are useful prose and locality context, but they are too common
// to prove that two local-news headlines describe the same event. The
// remaining shared tokens act as a compact, explainable event fingerprint.
const LOCAL_EVENT_STOP_WORDS = new Set([
  "after", "against", "amid", "announce", "announced", "announces", "area", "city", "community",
  "council", "county", "department", "former", "governor", "local", "mayor", "official", "officials",
  "plan", "plans", "police", "report", "reports", "says", "school", "state", "town", "township",
]);
const LOCAL_EVENT_TYPES = new Map([
  ["fire", /\b(?:blaze|fire)\b/i],
  ["crash", /\b(?:collision|crash|wreck)\b/i],
  ["shooting", /\b(?:gunfire|shot|shooting|shootout)\b/i],
  ["drowning", /\b(?:drown|drowned|drowning)\b/i],
]);

const canonicalLocalEventToken = (token) => {
  if (/^(?:boat|sailboat)$/.test(token)) return "boat";
  if (/^(?:die|dies|died|death|dead|kill|kills|killed)$/.test(token)) return "death";
  if (/^(?:shooting|shootout|shot)$/.test(token)) return "shooting";
  if (/^(?:steal|steals|stealing|stole|stolen|theft|thief)$/.test(token)) return "theft";
  return token;
};

const localEventTokens = (value) => [...new Set(headlineTokens(value)
  .filter((token) => !LOCAL_EVENT_STOP_WORDS.has(token))
  .map(canonicalLocalEventToken))];

const tokenSetSimilarity = (leftTokens, rightTokens) => {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return Number(((intersection / union) * 0.55 + (intersection / Math.min(left.size, right.size)) * 0.45).toFixed(3));
};

const eventNumbers = (value) => normalizeHeadline(value).split(" ")
  .filter((token) => /\d/.test(token) && !/^20\d{2}$/.test(token));

export const localEventMatch = (left, right) => {
  const leftTokens = localEventTokens(left);
  const rightTokenList = localEventTokens(right);
  const rightTokens = new Set(rightTokenList);
  const sharedTokens = leftTokens.filter((token) => rightTokens.has(token));
  const leftNumbers = eventNumbers(left);
  const rightNumbers = eventNumbers(right);
  const numberConflict = Boolean(leftNumbers.length && rightNumbers.length
    && !leftNumbers.some((number) => rightNumbers.includes(number)));
  const leftEventTypes = [...LOCAL_EVENT_TYPES].filter(([, pattern]) => pattern.test(String(left || ""))).map(([type]) => type);
  const rightEventTypes = [...LOCAL_EVENT_TYPES].filter(([, pattern]) => pattern.test(String(right || ""))).map(([type]) => type);
  const eventTypeConflict = Boolean(leftEventTypes.length && rightEventTypes.length
    && !leftEventTypes.some((type) => rightEventTypes.includes(type)));
  const similarity = tokenSetSimilarity(leftTokens, rightTokenList);
  return {
    aligned: Boolean(!numberConflict && !eventTypeConflict && ((sharedTokens.length >= 4 && similarity >= 0.33)
      || (sharedTokens.length >= 3 && similarity >= 0.42))),
    sharedTokens,
    similarity,
    numberConflict,
    eventTypeConflict,
  };
};

export const namedOrganizations = (value) => {
  const text = String(value || "");
  const matches = text.match(/\b(?:[A-Z][A-Za-z&'.-]+\s+){0,4}(?:Department|Authority|Commission|Council|Board|University|Hospital|Police|Court|Legislature|Senate|Assembly|Administration|Office)\b/g) || [];
  return [...new Set(matches.map((match) => match.trim()))];
};

export const properNounPhrases = (value) => {
  const matches = String(value || "").match(/\b(?:[A-Z][A-Za-z&'.-]+\s+){1,3}[A-Z][A-Za-z&'.-]+\b/g) || [];
  return [...new Set(matches.map((match) => normalizeHeadline(match)).filter(Boolean))];
};

const FATAL_OUTCOME_PATTERN = /\b(?:dead|death|deaths|die|dies|died|fatal|fatally|fatalities|fatality|kill|killed|kills)\b/i;
const FATAL_INCIDENT_TYPES = new Map([
  ["fire", /\b(?:blaze|blazes|fire|fires)\b/i],
  ["crash", /\b(?:collision|collisions|crash|crashes|wreck|wrecks)\b/i],
  ["shooting", /\b(?:gunfire|shot|shooting|shootings)\b/i],
  ["drowning", /\b(?:drown|drowned|drowning|drownings|drowns)\b/i],
]);
const FATAL_INCIDENT_PARTICIPANTS = new Map([
  ["child", /\b(?:boy|boys|child|children|girl|girls|infant|infants|kid|kids|toddler|toddlers)\b/i],
  ["adult", /\b(?:adult|adults|man|men|woman|women)\b/i],
  ["firefighter", /\b(?:firefighter|firefighters)\b/i],
  ["officer", /\b(?:officer|officers|police officer|police officers|trooper|troopers)\b/i],
  ["pedestrian", /\b(?:pedestrian|pedestrians)\b/i],
]);
const COUNT_VALUES = new Map(Object.entries({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}));
const COUNT_TERM = "(?:one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})";
const PARTICIPANT_COUNT_PATTERNS = new Map([
  ["child", new RegExp(`\\b(${COUNT_TERM})\\s+(?:young\\s+)?(?:boys?|children|girls?|infants?|kids?|toddlers?)\\b`, "i")],
  ["adult", new RegExp(`\\b(${COUNT_TERM})\\s+(?:adults?|men|women)\\b`, "i")],
  ["firefighter", new RegExp(`\\b(${COUNT_TERM})\\s+firefighters?\\b`, "i")],
  ["officer", new RegExp(`\\b(${COUNT_TERM})\\s+(?:police\\s+)?(?:officers?|troopers?)\\b`, "i")],
  ["pedestrian", new RegExp(`\\b(${COUNT_TERM})\\s+pedestrians?\\b`, "i")],
]);
const countValue = (value) => COUNT_VALUES.get(String(value).toLowerCase()) ?? Number.parseInt(value, 10);
const matchingKeys = (value, patterns) => [...patterns]
  .filter(([, pattern]) => pattern.test(value))
  .map(([key]) => key);

export const fatalIncidentSignature = (value) => {
  const text = String(value || "");
  const participants = matchingKeys(text, FATAL_INCIDENT_PARTICIPANTS);
  const participantCounts = Object.fromEntries(participants.flatMap((participant) => {
    const match = text.match(PARTICIPANT_COUNT_PATTERNS.get(participant));
    return match ? [[participant, countValue(match[1])]] : [];
  }));
  return {
    fatal: FATAL_OUTCOME_PATTERN.test(text),
    incidentTypes: matchingKeys(text, FATAL_INCIDENT_TYPES),
    participants,
    participantCounts,
  };
};

export const fatalIncidentMatch = (left, right) => {
  const a = fatalIncidentSignature(left);
  const b = fatalIncidentSignature(right);
  const incidentType = a.incidentTypes.find((value) => b.incidentTypes.includes(value)) || null;
  const participant = a.participants.find((value) => b.participants.includes(value)) || null;
  const leftCount = participant ? a.participantCounts[participant] : null;
  const rightCount = participant ? b.participantCounts[participant] : null;
  const countConflict = Number.isInteger(leftCount) && Number.isInteger(rightCount) && leftCount !== rightCount;
  return {
    aligned: Boolean(a.fatal && b.fatal && incidentType && participant && !countConflict),
    incidentType,
    participant,
    participantCount: Number.isInteger(leftCount) && leftCount === rightCount ? leftCount : null,
    countConflict,
  };
};

const NAMED_EVENT_ACTIONS = new Map([
  ["criminal_charge", /\b(?:arrest(?:s|ed|ing)?|accus(?:e|es|ed|ing)|charg(?:e|es|ed|ing)|indict(?:s|ed|ing|ment|ments))\b/i],
  ["civil_settlement", /\b(?:agree(?:s|d)?\s+to\s+pay|(?:will|to)\s+pay|settle(?:s|d|ment|ments)?|settling)\b/i],
  ["court_appeal", /\b(?:appeal(?:s|ed|ing)?|asks?\s+(?:a\s+)?court\s+to\s+(?:dismiss|overturn)|seeks?\s+(?:dismissal|review))\b/i],
  ["court_ruling", /\b(?:court\s+(?:allows?|blocks?|dismiss(?:es|ed)?|orders?|rules?|sides)|judge\s+(?:allows?|blocks?|dismiss(?:es|ed)?|orders?|rules?))\b/i],
  ["law_enactment", /\b(?:enact(?:s|ed|ing)?|sign(?:s|ed|ing)?(?:\s+[a-z'-]+){0,6}\s+(?:bill|law|legislation|measure|protections?)|(?:bill|legislation|measure)\s+(?:becomes?|signed\s+into)\s+law)\b/i],
]);

// These are deliberately narrow fact families, not a general topic classifier.
// A named-event match must share at least two of them, so an institution or
// public official appearing in multiple same-day stories is not enough to join
// those stories.
const NAMED_EVENT_TOPICS = new Map([
  ["covert_recording", /\b(?:film(?:s|ed|ing)?|record(?:s|ed|ing)?|upskirt|video(?:s|taped|taping)?)\b/i],
  ["privacy_intrusion", /\b(?:bathrooms?|invasion\s+of\s+privacy|locker\s+rooms?|restrooms?|secretly|upskirt)\b/i],
  ["reproductive_care", /\b(?:abortion|reproductive(?:\s+health)?(?:\s+care)?)\b/i],
  ["gender_affirming_care", /\b(?:gender[-\s]+affirming(?:\s+health)?(?:\s+care)?|transgender(?:\s+health)?(?:\s+care)?)\b/i],
  ["legal_protection", /\b(?:protect(?:s|ed|ing|ions?)?|safeguard(?:s|ed|ing)?|shield(?:s|ed|ing)?)(?:\s+law)?\b/i],
  ["social_media", /\b(?:facebook|instagram|meta|social[-\s]+media|social[-\s]+network|social[-\s]+platform)\b/i],
  ["youth_safety", /\b(?:adolescents?|children|kids?|minors?|teenagers?|teens?|youth)\b/i],
  ["sexual_abuse", /\b(?:child\s+sexual\s+abuse|molest(?:s|ed|ation)?|sex(?:ual)?\s+abuse|sexually\s+abus(?:e|ed))\b/i],
  ["institutional_liability", /\b(?:boys?\s+(?:and|&)\s+girls?\s+club|institutional\s+liability|liable|liability|youth\s+organization)\b/i],
  ["immigration_case", /\b(?:delaney\s+hall|ice\s+(?:detention|facility)|immigration\s+(?:detention|facility)|newark\s+detention)\b/i],
  ["federal_charge", /\b(?:federal\s+(?:charge|charges|case|prosecutors?)|congress(?:woman|man)|representative)\b/i],
]);

const PERSON_NAME_TERM = "[A-Z][A-Za-z]+(?:[-'][A-Za-z]+)?";
const PERSON_ACTION_TERM = "(?:appeal(?:s|ed)?|arrest(?:s|ed)?|accus(?:e|es|ed)|charg(?:e|es|ed)|indict(?:s|ed)|enact(?:s|ed)?|sign(?:s|ed)?)";
const NON_PERSON_NAMES = new Set([
  "associated press", "new jersey", "new york", "united states",
]);
const NON_PERSON_TERMS = new Set([
  "administration", "assembly", "authority", "board", "city", "commission", "council", "county",
  "department", "governor", "hospital", "jersey", "legislature", "office", "police", "press",
  "school", "senate", "state", "university",
]);
const normalizedAnchor = (value) => normalizeHeadline(value).trim();
const personAnchorKeys = (value) => {
  const text = String(value || "");
  const patterns = [
    new RegExp(`\\b(${PERSON_NAME_TERM}(?:\\s+${PERSON_NAME_TERM}){1,2})(?=,?\\s+(?:(?:is|was|has\\s+been)\\s+)?${PERSON_ACTION_TERM}\\b)`, "g"),
    new RegExp(`\\b(?:dean|professor|coach)\\s+(${PERSON_NAME_TERM}(?:\\s+${PERSON_NAME_TERM}){1,2})\\b`, "g"),
    new RegExp(`\\b(?:Congress(?:woman|man)|Gov(?:ernor)?|Mayor|Sen(?:ator)?|Rep(?:resentative)?|Dr)\\.?\\s+(${PERSON_NAME_TERM}(?:\\s+${PERSON_NAME_TERM}){0,2})\\b`, "g"),
    new RegExp(`^\\s*(${PERSON_NAME_TERM}(?:\\s+${PERSON_NAME_TERM}){0,2})\\s+${PERSON_ACTION_TERM}\\b`, "g"),
  ];
  const names = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => normalizedAnchor(match[1])));
  return [...new Set(names.flatMap((name) => {
    if (!name || NON_PERSON_NAMES.has(name) || name.split(" ").some((term) => NON_PERSON_TERMS.has(term))) return [];
    const terms = name.split(" ");
    const surname = terms.at(-1);
    return [name, ...(surname?.length >= 5 ? [surname] : [])];
  }))];
};
const organizationAnchorKeys = (value) => {
  const text = String(value || "");
  const organizationVariants = (name) => {
    const cleaned = normalizedAnchor(name).replace(/^the\s+/, "");
    const first = cleaned.split(" ")[0];
    return [cleaned, ...(first?.length >= 5 && !["new", "state", "united", "the"].includes(first) ? [first] : [])];
  };
  const formal = namedOrganizations(text).flatMap(organizationVariants);
  const institutionalSubjects = [...text.matchAll(/\b((?:[A-Z][A-Za-z&'.-]+\s+){0,3}[A-Z][A-Za-z&'.-]+)(?:['’]s)?\s+(?:dean|faculty|hospital|professor|school|university)\b/g)]
    .flatMap((match) => organizationVariants(match[1]));
  const legalOrCorporateContext = /\b(?:agrees?\s+to\s+pay|(?:will|to)\s+pay|company|corporation|court|judge|lawsuit|liable|platform|settle(?:s|d|ment|ments)?|social[-\s]+media)\b/i.test(text);
  const brandSubjects = legalOrCorporateContext
    ? [...text.matchAll(/\b[A-Z][A-Za-z0-9&'.-]{3,}\b/g)]
      .map((match) => normalizedAnchor(match[0]))
      .filter((name) => !new Set(["court", "federal", "jersey", "newark", "state", "supreme", "united"]).has(name))
    : [];
  return [...new Set([...formal, ...institutionalSubjects, ...brandSubjects]
    .filter((name) => name && !["university", "hospital", "school"].includes(name)))];
};
const sharedValue = (left = [], right = []) => left.find((value) => right.includes(value)) || null;

export const namedEventSignature = (value) => ({
  actions: matchingKeys(String(value || ""), NAMED_EVENT_ACTIONS),
  topics: matchingKeys(String(value || ""), NAMED_EVENT_TOPICS),
  people: personAnchorKeys(value),
  organizations: organizationAnchorKeys(value),
});

export const namedEventMatch = (left, right) => {
  const a = namedEventSignature(left);
  const b = namedEventSignature(right);
  const action = sharedValue(a.actions, b.actions);
  const person = sharedValue(a.people, b.people);
  const organization = sharedValue(a.organizations, b.organizations);
  const sharedTopics = a.topics.filter((topic) => b.topics.includes(topic));
  const personConflict = Boolean(a.people.length && b.people.length && !person);
  const anchor = person || organization;
  return {
    aligned: Boolean(action && anchor && sharedTopics.length >= 2 && !personConflict),
    action,
    anchor,
    anchorType: person ? "person" : organization ? "organization" : null,
    topics: sharedTopics,
    personConflict,
  };
};

const MONTH_NAME_PATTERN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const EXPLICIT_DATE_RANGE_PATTERN = `\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})\\s*[-–—]\\s*(?:(${MONTH_NAME_PATTERN})\\s+)?(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`;
const EXPLICIT_DATE_PATTERN = `\\b(?:${MONTH_NAME_PATTERN}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|20\\d{2})\\b`;
const MONTH_NUMBERS = new Map(Object.entries({
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", september: "09", oct: "10", october: "10",
  nov: "11", november: "11", dec: "12", december: "12",
}));
const fourDigitYear = (value) => {
  const year = Number.parseInt(value, 10);
  if (!Number.isFinite(year)) return null;
  return String(year < 100 ? 2000 + year : year).padStart(4, "0");
};
const normalizeExplicitDate = (value) => {
  const cleaned = String(value || "").toLowerCase().replaceAll(",", " ").trim().replace(/\s+/g, " ");
  if (/^20\d{2}$/.test(cleaned)) return cleaned;
  const named = cleaned.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (named) {
    const month = MONTH_NUMBERS.get(named[1]);
    return month ? `${named[3] || "*"}-${month}-${named[2].padStart(2, "0")}` : cleaned;
  }
  const numeric = cleaned.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numeric) return `${numeric[3] ? fourDigitYear(numeric[3]) : "*"}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  return cleaned.replace(/[\s,/-]+/g, "-");
};

export const explicitDateTerms = (value) => {
  const text = String(value || "");
  const rangeTerms = [...text.matchAll(new RegExp(EXPLICIT_DATE_RANGE_PATTERN, "gi"))].flatMap((match) => {
    const [, startMonth, startDay, endMonth, endDay, year] = match;
    const suffix = year ? ` ${year}` : "";
    return [
      normalizeExplicitDate(`${startMonth} ${startDay}${suffix}`),
      normalizeExplicitDate(`${endMonth || startMonth} ${endDay}${suffix}`),
    ];
  });
  const matches = text.match(new RegExp(EXPLICIT_DATE_PATTERN, "gi")) || [];
  return [...new Set([...rangeTerms, ...matches.map(normalizeExplicitDate)])];
};

export const explicitDatesCompatible = (left = [], right = []) => {
  const datedTerm = /^(?:\*|20\d{2})-\d{2}-\d{2}$/;
  const leftDated = left.filter((value) => datedTerm.test(value));
  const rightDated = right.filter((value) => datedTerm.test(value));
  const comparableLeft = leftDated.length && rightDated.length ? leftDated : left;
  const comparableRight = leftDated.length && rightDated.length ? rightDated : right;
  return comparableLeft.some((a) => comparableRight.some((b) => {
  if (a === b) return true;
  const leftParts = a.match(/^(\*|20\d{2})-(\d{2})-(\d{2})$/);
  const rightParts = b.match(/^(\*|20\d{2})-(\d{2})-(\d{2})$/);
  return Boolean(leftParts && rightParts
    && leftParts[2] === rightParts[2]
    && leftParts[3] === rightParts[3]
    && (leftParts[1] === "*" || rightParts[1] === "*" || leftParts[1] === rightParts[1]));
  }));
};

export const stripExplicitDates = (value) => String(value || "")
  .replace(new RegExp(EXPLICIT_DATE_RANGE_PATTERN, "gi"), " ")
  .replace(new RegExp(EXPLICIT_DATE_PATTERN, "gi"), " ");

const LIVE_VENUE_PATTERN = /^(.+?)\s+live!?\s+at\s+(.+?)\s*$/i;

export const liveVenueSubjectsConflict = (left, right) => {
  const leftMatch = String(left || "").trim().match(LIVE_VENUE_PATTERN);
  const rightMatch = String(right || "").trim().match(LIVE_VENUE_PATTERN);
  if (!leftMatch || !rightMatch) return false;
  return tokenSimilarity(leftMatch[2], rightMatch[2]) >= 0.9
    && tokenSimilarity(leftMatch[1], rightMatch[1]) === 0;
};
