const ACCESSORY_PATTERNS = [
  ["fietsendrager", /\bfiets(?:en)?\s*drager\b|\bfietsenrek\b/i],
  ["verplaatser", /\bverplaatser\b|\bremorque\b/i],
  ["boiler/waterverwarmer", /\bchauffe\s*eau\b|\bboiler\b|\bwaterverwarmer\b/i],
  ["matras", /\bmat(?:e|r)las\b|\bmatras\b|\bmatrassen\b/i],
  ["kussens", /\bkussens?(?:et)?\b/i],
  ["gordijn", /\bgordijn(?:en)?\b|\bgordijnen\b/i],
  ["luifel", /\bluifel\b|\bcaravanluifel\b|\bauvent\b|\bsolette\b|\bsunroof\b|\bvoortent(?:luifel)?\b|\bdeelsvoortent\b/i],
  ["brandstoftank", /\bbrandstoftank\b/i],
  ["airco", /\bairco\b|\bairconditioning\b|\bclim(?:atisation)?\b/i],
  ["daktent/winterdak", /\bdaktent\b|\bwinterdak\b/i],
  ["mover", /\bmover\b|\brobot\s*trolley\b/i],
  ["aanhangwagen", /\baanhangwagen\b|\bbakaanhangwagen\b|\bkipper\b/i],
  ["los chassis", /\bchassis\b/i]
];

const NON_SALE_PATTERNS = [
  ["huur", /\bte huur\b|\bà louer\b|\ba louer\b|\bverhuur\b|\blouer\b/i],
  ["stalling", /\bstalling\b|\bstaanplaats\b/i],
  ["gevraagd", /\bgevraagd\b|\bgezocht\b|\binkoop\b|\bkopen alle\b/i]
];

const NON_CARAVAN_PATTERNS = [
  ["mobilhome/camping-car", /\bmobilhome\b|\bcamping\s*car\b|\bcamper\b/i],
  ["foodtruck/container", /\bfood\s*truck\b|\bfoodtruck\b|\bconteneur\b|\bcontainer\b/i],
  ["werfkeet/bouwkeet", /\bwerfkeet\b|\bbouwkeet\b|\bschaftwagen\b/i],
  ["chantier", /\bchantier\b/i]
];

const STRONG_CARAVAN_PATTERNS = [
  /\bcaravan\b/i,
  /\bcaravane\b/i,
  /\bcaravanes\b/i,
  /\bcaravannetje\b/i,
  /\bspeelcaravan\b/i,
  /\bstacaravan\b/i,
  /\bcaravsn\b/i,
  /\bcaravene\b/i,
  /\bcarane\b/i,
  /\btrekcaravan\b/i,
  /\btrekkingcaravan\b/i,
  /\bplooicaravan\b/i,
  /\bvouwcaravan\b/i,
  /\bopvouwbare\s+caravan\b/i,
  /\bteardrop\b/i,
  /\bchateau\b/i,
  /\bconstructam\b/i,
  /\badria\b/i,
  /\bknaus\b/i,
  /\bhobby\b/i,
  /\bb[üu]rstner\b/i,
  /\bbustner\b/i,
  /\bbeyerland\b/i,
  /\bpredom\b/i,
  /\btabbert\b/i,
  /\btabbett\b/i,
  /\bfendt\b/i,
  /\bcaravelair\b/i,
  /\bsterckeman\b/i,
  /\bde\s*reu\b/i,
  /\bgruau\b/i,
  /\brapido\b/i,
  /\bwilk\b/i,
  /\bkip\b/i,
  /\bhome-?car\b/i,
  /\bdethleffs\b/i,
  /\besterel\b/i
];

function textFor(candidate) {
  const slug = candidate.url
    ? decodeURIComponent(new URL(candidate.url).pathname.split("/").pop() || "")
    : "";
  return `${candidate.title || ""} ${slug}`.replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchAny(patterns, text) {
  for (const [reason, pattern] of patterns) {
    if (pattern.test(text)) {
      return reason;
    }
  }
  return null;
}

function hasStrongCaravanSignal(text) {
  return STRONG_CARAVAN_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyCaravanCandidate(candidate) {
  const text = textFor(candidate);

  const nonSaleReason = matchAny(NON_SALE_PATTERNS, text);
  if (nonSaleReason) {
    return { keep: false, reason: nonSaleReason };
  }

  const accessoryReason = matchAny(ACCESSORY_PATTERNS, text);
  if (accessoryReason) {
    return { keep: false, reason: accessoryReason };
  }

  const nonCaravanReason = matchAny(NON_CARAVAN_PATTERNS, text);
  if (nonCaravanReason === "foodtruck/container") {
    return { keep: false, reason: nonCaravanReason };
  }

  if (nonCaravanReason && !hasStrongCaravanSignal(text)) {
    return { keep: false, reason: nonCaravanReason };
  }

  if (/\b750\s*kg\b|\b750kg\b/i.test(text) && !/\btrailer\b|\baanhangwagen\b/i.test(text)) {
    return { keep: true, reason: "lijkt caravan" };
  }

  if (!hasStrongCaravanSignal(text)) {
    return { keep: false, reason: "geen duidelijke caravan-indicatie" };
  }

  return { keep: true, reason: "lijkt caravan" };
}

export function filterCaravanCandidates(candidates) {
  const kept = [];
  const rejected = [];

  for (const candidate of candidates) {
    const classification = classifyCaravanCandidate(candidate);
    if (classification.keep) {
      kept.push(candidate);
    } else {
      rejected.push({ ...candidate, rejectReason: classification.reason });
    }
  }

  return { kept, rejected };
}
