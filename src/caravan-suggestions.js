function textFor(candidate) {
  const slug = candidate.url
    ? decodeURIComponent(new URL(candidate.url).pathname.split("/").pop() || "")
    : "";
  return `${candidate.title || ""} ${candidate.summary || ""} ${slug}`
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function suggestCaravanFields(candidate) {
  const text = textFor(candidate);

  let grootte = "MEDIUM";
  if (
    includesAny(text, [
      /\bmini\b/i,
      /\bklein(?:e)?\b/i,
      /\bteardrop\b/i,
      /\bplooicaravan\b/i,
      /\bvouwcaravan\b/i,
      /\bcaravannetje\b/i,
      /\b[23]\s*pers/i,
      /\b750\s*kg\b/i,
      /\b750kg\b/i,
      /\b[23](?:[,.]\d)?\s*m(?:eter)?\b/i
    ])
  ) {
    grootte = "KLEIN";
  }
  if (
    includesAny(text, [
      /\bgroot(?:e)?\b/i,
      /\blange\b/i,
      /\bstacaravan\b/i,
      /\bresidenti[eë]lle?\b/i,
      /\bdubbel(?:e)?\s+as\b/i,
      /\bdouble\s+essieu\b/i,
      /\b[56]\s*pers/i,
      /\b[56](?:[,.]\d)?\s*m(?:eter)?\b/i,
      /\b1[2-9]\d{2}\s*kg\b/i
    ])
  ) {
    grootte = "GROOT";
  }

  let rijdtNog = "?";
  if (
    includesAny(text, [
      /\brij(?:dt|den)\b/i,
      /\bkan nog rijden\b/i,
      /\btractable\b/i,
      /\bkeuring(?:svrij)?\b/i,
      /\bgekeurd\b/i,
      /\beigen\s+num(?:m)?erplaat\b/i,
      /\bmtm\b/i,
      /\bdirect op vakantie\b/i,
      /\bklaar voor vertrek\b/i
    ])
  ) {
    rijdtNog = "JOPS";
  }
  if (
    includesAny(text, [
      /\btransporteur vereist\b/i,
      /\blichten .*niet\b/i,
      /\bniet rijdbaar\b/i,
      /\bniet meer rij(?:dt|den)\b/i,
      /\bwerfkeet\b/i,
      /\bbouwkeet\b/i,
      /\bkippenhok\b/i,
      /\bzonder wielen\b/i
    ])
  ) {
    rijdtNog = "NEE";
  }

  let staat = "?";
  if (
    includesAny(text, [
      /\bop te knappen\b/i,
      /\bte renoveren\b/i,
      /\brestaur/i,
      /\bproject\b/i,
      /\bwerk\b/i,
      /\bzonder papieren\b/i,
      /\bgeen papieren\b/i,
      /\bongekeurd\b/i,
      /\bverval\b/i
    ])
  ) {
    staat = "Verval?";
  }
  if (
    includesAny(text, [
      /\bgoede staat\b/i,
      /\bzeer goede staat\b/i,
      /\bperfecte staat\b/i,
      /\bnette\b/i,
      /\bmooi(?:e)?\b/i,
      /\bgerenoveerd\b/i,
      /\bexcellent\b/i,
      /\balles werkt\b/i,
      /\bklaar\b/i
    ])
  ) {
    staat = "Lijkt in orde";
  }

  return { grootte, rijdtNog, staat };
}
