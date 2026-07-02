import argparse
import base64
import csv
import hashlib
import html
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import quote_plus, unquote, urlparse, parse_qs

import requests


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "resources" / "leegstandsregister_stad_antwerpen.csv"
OUTPUT_DIR = ROOT / "outputs"
CACHE_DIR = OUTPUT_DIR / "contact_enrichment_cache"
OUTPUT_CSV = OUTPUT_DIR / "leegstand_contact_enrichment.csv"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.I)
KBO_RE = re.compile(r"\b(?:BE\s*)?0?\d{3}[.\s]?\d{3}[.\s]?\d{3}\b", re.I)
TAG_RE = re.compile(r"<[^>]+>")

GENERIC_EMAIL_PREFIXES = {
    "info",
    "contact",
    "hello",
    "hallo",
    "admin",
    "office",
    "mail",
    "team",
    "sales",
    "verhuur",
    "vastgoed",
    "immo",
    "beheer",
    "secretariaat",
    "onthaal",
    "support",
    "service",
    "invest",
}

NOISE_DOMAINS = {
    "postcodebijadres.be",
    "realo.be",
    "immoweb.be",
    "zimmo.be",
    "heylenvastgoed.be",
    "google.com",
    "maps.google.com",
}

BUSINESS_DIRECTORY_DOMAINS = {
    "companyweb.be",
    "webhero.be",
    "trendstop.knack.be",
    "staatsbladmonitor.be",
    "kbopub.economie.fgov.be",
    "bizzy.org",
    "graydoncreditsafe.com",
}

SOCIAL_DOMAINS = {
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
}

NEWS_OR_PROPERTY_NOISE = {
    "gva.be",
    "hln.be",
    "nieuwsblad.be",
    "vrt.be",
    "atv.be",
    "realo.be",
    "immoscoop.be",
    "zimmo.be",
    "immoweb.be",
}


def clean_text(value):
    value = html.unescape(value or "")
    value = TAG_RE.sub(" ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def norm(value):
    value = clean_text(value).lower()
    value = value.replace("'", "")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def domain_of(url):
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def unwrap_duckduckgo_url(url):
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlparse(url)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        if target:
            return unquote(target)
    return url


def unwrap_bing_url(url):
    parsed = urlparse(url)
    if "bing.com" not in parsed.netloc or not parsed.path.startswith("/ck/"):
        return url
    encoded = parse_qs(parsed.query).get("u", [""])[0]
    if not encoded:
        return url
    candidates = [encoded]
    if encoded.startswith("a1"):
        candidates.append(encoded[2:])
    for candidate in candidates:
        try:
            padded = candidate + "=" * (-len(candidate) % 4)
            decoded = base64.urlsafe_b64decode(padded).decode("utf-8", errors="ignore")
            if decoded.startswith("http"):
                return decoded
        except Exception:
            continue
    return url


def extract_attr(tag, attr):
    match = re.search(rf'{attr}=["\']([^"\']+)["\']', tag, re.I)
    return html.unescape(match.group(1)) if match else ""


def parse_duckduckgo_results(markup):
    results = []
    blocks = re.split(r'<div[^>]+class="[^"]*result[^"]*"[^>]*>', markup, flags=re.I)
    for block in blocks[1:]:
        link_match = re.search(r'<a[^>]+class="[^"]*result__a[^"]*"[^>]*>.*?</a>', block, re.I | re.S)
        if not link_match:
            continue
        link_tag = link_match.group(0)
        url = unwrap_duckduckgo_url(extract_attr(link_tag, "href"))
        title = clean_text(link_tag)
        snippet_match = re.search(r'<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>.*?</a>', block, re.I | re.S)
        if not snippet_match:
            snippet_match = re.search(r'<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>.*?</div>', block, re.I | re.S)
        snippet = clean_text(snippet_match.group(0)) if snippet_match else ""
        if url and title:
            results.append({"title": title, "url": url, "snippet": snippet, "domain": domain_of(url)})
    return results[:8]


def parse_bing_results(markup):
    results = []
    blocks = re.split(r"<li[^>]+class=[^>]+b_algo[^>]*>", markup, flags=re.I)
    for block in blocks[1:]:
        h2_match = re.search(r"<h2[^>]*>.*?</h2>", block, re.I | re.S)
        link_scope = h2_match.group(0) if h2_match else block[:3000]
        link_match = re.search(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>.*?</a>', link_scope, re.I | re.S)
        if not link_match:
            continue
        url = unwrap_bing_url(html.unescape(link_match.group(1)))
        title = clean_text(link_match.group(0))
        snippet_match = re.search(r"<p[^>]*>.*?</p>", block, re.I | re.S)
        snippet = clean_text(snippet_match.group(0)) if snippet_match else ""
        if url and title:
            results.append({"title": title, "url": url, "snippet": snippet, "domain": domain_of(url)})
    return results[:8]


def address_rows():
    grouped = {}
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            key_parts = [
                row.get("pva_straat", "").strip(),
                row.get("pva_huisnr1", "").strip(),
                row.get("pva_huisnr2", "").strip(),
                row.get("pva_busnr", "").strip(),
                row.get("pva_postcode", "").strip(),
                row.get("pnd_district", "").strip(),
            ]
            key = "|".join(key_parts)
            if key not in grouped:
                grouped[key] = {
                    "address_key": key,
                    "street": key_parts[0],
                    "huisnr1": key_parts[1],
                    "huisnr2": key_parts[2],
                    "busnr": key_parts[3],
                    "postcode": key_parts[4],
                    "district": key_parts[5],
                    "rows": [],
                }
            grouped[key]["rows"].append(row)
    return list(grouped.values())


def display_address(item):
    number = item["huisnr1"]
    if item["huisnr2"]:
        number = f"{number}-{item['huisnr2']}"
    bus = f" bus {item['busnr']}" if item["busnr"] else ""
    return f"{item['street'].title()} {number}{bus}, {item['postcode']} {item['district']}"


def search_query(item):
    street = item["street"].title()
    house = item["huisnr1"]
    postcode = item["postcode"]
    district = item["district"]
    return f'"{street} {house}" "{postcode}" "{district}"'


def cache_path(item):
    digest = hashlib.sha1(item["address_key"].encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def fetch(url, timeout=20):
    return requests.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.7"},
        timeout=timeout,
    )


def ddg_search(query):
    url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    response = fetch(url)
    response.raise_for_status()
    return parse_duckduckgo_results(response.text)


def bing_search(query):
    url = f"https://www.bing.com/search?q={quote_plus(query)}"
    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.7"},
        timeout=20,
    )
    response.raise_for_status()
    return parse_bing_results(response.text)


def web_search(query):
    results = bing_search(query)
    if results:
        return results
    return ddg_search(query)


def is_generic_email(email):
    prefix = email.split("@", 1)[0].lower()
    if prefix in GENERIC_EMAIL_PREFIXES:
        return True
    if any(prefix.startswith(value + ".") or prefix.startswith(value + "-") for value in GENERIC_EMAIL_PREFIXES):
        return True
    return False


def extract_socials(text):
    links = set()
    for match in re.findall(r"https?://[^\s\"'<>]+", text or "", re.I):
        domain = domain_of(match)
        if any(domain == social or domain.endswith("." + social) for social in SOCIAL_DOMAINS):
            links.add(match.rstrip(").,;"))
    return sorted(links)


def fetch_page_signals(result):
    signals = {"emails": [], "socials": [], "kbo_numbers": [], "title": ""}
    domain = result["domain"]
    if domain in NOISE_DOMAINS:
        return signals
    try:
        response = fetch(result["url"], timeout=12)
        content_type = response.headers.get("content-type", "")
        if response.status_code >= 400 or "text/html" not in content_type:
            return signals
        text = response.text[:750_000]
    except Exception:
        return signals

    title_match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    signals["title"] = clean_text(title_match.group(1)) if title_match else ""
    emails = {email.lower() for email in EMAIL_RE.findall(html.unescape(text))}
    signals["emails"] = sorted(email for email in emails if is_generic_email(email))
    signals["socials"] = extract_socials(text)
    signals["kbo_numbers"] = sorted(set(KBO_RE.findall(text)))
    return signals


def score_result(item, result):
    haystack = norm(" ".join([result["title"], result["snippet"], result["url"]]))
    street = norm(item["street"])
    house = norm(item["huisnr1"])
    house2 = norm(item["huisnr2"])
    postcode = norm(item["postcode"])
    district = norm(item["district"])
    score = 0
    reasons = []

    if street and street in haystack:
        score += 35
        reasons.append("straat")
    if house and re.search(rf"\b{re.escape(house)}\b", haystack):
        score += 20
        reasons.append("huisnr")
    elif house2 and re.search(rf"\b{re.escape(house2)}\b", haystack):
        score += 15
        reasons.append("huisnr")
    if postcode and postcode in haystack:
        score += 30
        reasons.append("postcode")
    if district and norm(district) in haystack:
        score += 10
        reasons.append("district")

    domain = result["domain"]
    if domain in BUSINESS_DIRECTORY_DOMAINS:
        score += 10
        reasons.append("bedrijvengids")
    if domain in NOISE_DOMAINS:
        score -= 20
        reasons.append("vastgoed/noise")
    if any(domain == social or domain.endswith("." + social) for social in SOCIAL_DOMAINS):
        score += 5
        reasons.append("social")
    return score, reasons


def infer_org_name(results):
    for result in results:
        title = result.get("title", "")
        for sep in [" - Companyweb", " | Companyweb", " - Webhero", " Antwerpen"]:
            if sep in title:
                name = title.split(sep, 1)[0].strip()
                if 4 <= len(name) <= 120:
                    return name
        if "BE " in title or "BV" in title.upper() or "VZW" in title.upper():
            return title[:120]
    return ""


def enrich_one(item, refresh=False):
    path = cache_path(item)
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))

    query = search_query(item)
    record = {
        "address": display_address(item),
        "address_key": item["address_key"],
        "query": query,
        "results": [],
        "status": "searched",
        "error": "",
    }
    try:
        results = web_search(query)
        scored = []
        for result in results:
            score, reasons = score_result(item, result)
            result["score"] = score
            result["reasons"] = reasons
            scored.append(result)
        scored.sort(key=lambda value: value["score"], reverse=True)

        for result in scored[:4]:
            if result["score"] >= 45 and "huisnr" in result["reasons"]:
                signals = fetch_page_signals(result)
                result["page_title"] = signals["title"]
                result["emails"] = signals["emails"]
                result["socials"] = signals["socials"]
                result["kbo_numbers"] = signals["kbo_numbers"]
            else:
                result["emails"] = [
                    email.lower()
                    for email in EMAIL_RE.findall(result["snippet"])
                    if is_generic_email(email)
                ]
                result["socials"] = extract_socials(result["url"] + " " + result["snippet"])
                result["kbo_numbers"] = KBO_RE.findall(result["snippet"])
        record["results"] = scored
    except Exception as exc:
        record["status"] = "error"
        record["error"] = str(exc)

    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def summarize_record(item, record):
    rows = item["rows"]
    aard = Counter(row.get("reg_aard", "") or "onbekend" for row in rows)
    oldest_dates = sorted(row.get("reg_opnamedatum", "") for row in rows if row.get("reg_opnamedatum", ""))
    top_results = [
        result
        for result in record.get("results", [])
        if result.get("score", 0) >= 65 and "huisnr" in result.get("reasons", [])
    ]
    medium_results = [
        result
        for result in record.get("results", [])
        if result.get("score", 0) >= 45 and "huisnr" in result.get("reasons", [])
    ]
    relevant = top_results or medium_results

    emails = []
    socials = []
    kbo_numbers = []
    urls = []
    titles = []
    for result in relevant[:4]:
        emails.extend(result.get("emails", []))
        socials.extend(result.get("socials", []))
        kbo_numbers.extend(result.get("kbo_numbers", []))
        urls.append(result.get("url", ""))
        titles.append(result.get("title", ""))

    emails = sorted(set(emails))
    socials = sorted(set(socials))
    kbo_numbers = sorted(set(kbo_numbers))
    relevant_domains = {result.get("domain", "") for result in relevant}
    has_business_directory = bool(relevant_domains & BUSINESS_DIRECTORY_DOMAINS)
    only_noise_sources = bool(relevant_domains) and relevant_domains.issubset(NEWS_OR_PROPERTY_NOISE | NOISE_DOMAINS)

    best_score = max([result.get("score", 0) for result in record.get("results", [])] or [0])
    if record.get("status") == "error":
        status = "zoekfout"
    elif emails or socials:
        status = "digitale_contactinfo_gevonden"
    elif relevant and has_business_directory and not only_noise_sources:
        status = "mogelijke_organisatie_gevonden_geen_contact"
    else:
        status = "geen_betrouwbare_digitale_match"

    confidence = "hoog" if best_score >= 85 else "middel" if best_score >= 65 else "laag" if best_score >= 45 else "geen"

    return {
        "address": record.get("address", display_address(item)),
        "street": item["street"],
        "huisnr1": item["huisnr1"],
        "huisnr2": item["huisnr2"],
        "busnr": item["busnr"],
        "postcode": item["postcode"],
        "district": item["district"],
        "source_row_count": len(rows),
        "aard_summary": "; ".join(f"{name}:{count}" for name, count in aard.most_common()),
        "oldest_opnamedatum": oldest_dates[0] if oldest_dates else "",
        "search_query": record.get("query", ""),
        "status": status,
        "confidence": confidence,
        "best_score": best_score,
        "organization_name_candidate": infer_org_name(relevant),
        "kbo_numbers": "; ".join(kbo_numbers[:5]),
        "generic_emails": "; ".join(emails[:5]),
        "social_links": "; ".join(socials[:5]),
        "source_urls": "; ".join(url for url in urls if url),
        "source_titles": " | ".join(title for title in titles if title),
        "notes": record.get("error", ""),
    }


def write_output(items, records):
    summaries = [summarize_record(item, records[item["address_key"]]) for item in items if item["address_key"] in records]
    fieldnames = [
        "address",
        "street",
        "huisnr1",
        "huisnr2",
        "busnr",
        "postcode",
        "district",
        "source_row_count",
        "aard_summary",
        "oldest_opnamedatum",
        "search_query",
        "status",
        "confidence",
        "best_score",
        "organization_name_candidate",
        "kbo_numbers",
        "generic_emails",
        "social_links",
        "source_urls",
        "source_titles",
        "notes",
    ]
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(summaries)
    return summaries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="maximum number of unique addresses to process")
    parser.add_argument("--offset", type=int, default=0, help="unique address offset")
    parser.add_argument("--delay", type=float, default=1.0, help="delay between uncached searches")
    parser.add_argument("--refresh", action="store_true", help="ignore cached address lookups")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)

    items = address_rows()
    selected = items[args.offset :]
    if args.limit:
        selected = selected[: args.limit]

    records = {}
    cached_or_done = 0
    for idx, item in enumerate(selected, start=args.offset + 1):
        was_cached = cache_path(item).exists() and not args.refresh
        record = enrich_one(item, refresh=args.refresh)
        records[item["address_key"]] = record
        cached_or_done += 1
        if cached_or_done % 10 == 0 or not was_cached:
            print(f"{idx}/{len(items)} {record.get('status')} {record.get('address')}", flush=True)
        if not was_cached:
            time.sleep(args.delay)

    for item in items:
        path = cache_path(item)
        if item["address_key"] not in records and path.exists():
            records[item["address_key"]] = json.loads(path.read_text(encoding="utf-8"))

    summaries = write_output(items, records)
    status_counts = Counter(row["status"] for row in summaries)
    print(f"Wrote {OUTPUT_CSV}")
    print(json.dumps(status_counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
