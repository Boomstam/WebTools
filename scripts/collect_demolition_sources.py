import csv
import html
import json
import re
from pathlib import Path
from urllib.parse import urljoin

import requests


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "outputs" / "demolition_sources"
RAW_HTML = SOURCE_DIR / "consultatieomgeving_beslissingen_page1.html"
RAW_JSON = SOURCE_DIR / "consultatieomgeving_beslissingen_records.json"
RAW_CSV = SOURCE_DIR / "consultatieomgeving_beslissingen_records.csv"
DEMOLITION_CSV = SOURCE_DIR / "consultatieomgeving_sloop_candidates.csv"
OPEN_HTML = SOURCE_DIR / "consultatieomgeving_openbare_onderzoeken.html"
OPEN_JSON = SOURCE_DIR / "consultatieomgeving_openbare_onderzoeken_records.json"
OPEN_CSV = SOURCE_DIR / "consultatieomgeving_openbare_onderzoeken_records.csv"
OPEN_DEMOLITION_CSV = SOURCE_DIR / "consultatieomgeving_openbare_onderzoeken_sloop_candidates.csv"
COMBINED_DEMOLITION_CSV = SOURCE_DIR / "consultatieomgeving_combined_sloop_candidates.csv"

BASE_URL = "https://antwerpen.consultatieomgeving.net"
DECISIONS_URL = f"{BASE_URL}/burger/nl/Beslissingen"
OPEN_URL = f"{BASE_URL}/burger/nl/OpenbareOnderzoeken"

DEMOLITION_RE = re.compile(
    r"\b(slopen|sloop|afbraak|afbreken|afgebroken|gedeeltelijk slopen|slopen en nieuwbouw|na het slopen)\b",
    re.I,
)
OMV_RE = re.compile(r"\bOMV_\d+\b")


def clean_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    value = value.replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def fetch_url(url, output_path):
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "nl-BE,nl;q=0.9"},
        timeout=30,
    )
    response.raise_for_status()
    output_path.write_text(response.text, encoding="utf-8")
    return response.text


def split_title(title):
    omv_match = OMV_RE.search(title)
    omv = omv_match.group(0) if omv_match else ""

    decision_status = ""
    if omv_match:
        after_omv = title[omv_match.end() :]
        status_match = re.search(r"\)\s*-\s*(.+)$", title[omv_match.start() :])
        if status_match:
            decision_status = status_match.group(1).strip()

    before_omv = title[: omv_match.start()].strip() if omv_match else title
    if " - " in before_omv:
        address_text, description = before_omv.split(" - ", 1)
    else:
        address_text, description = before_omv, ""

    description = re.sub(r"\(?OMV_\d+\)?", "", description).strip(" -")
    decision_status = decision_status.strip(" -")
    return address_text.strip(" -"), description.strip(), omv, decision_status


def parse_decision_date(block):
    match = re.search(r'<span[^>]+class="[^"]*remBeslissingDatum[^"]*"[^>]*>(.*?)</span>', block, re.I | re.S)
    return clean_text(match.group(1)) if match else ""


def parse_public_inquiry_dates(block):
    start = re.search(r'<span[^>]+class="[^"]*remOoDatumVan[^"]*"[^>]*>(.*?)</span>', block, re.I | re.S)
    end = re.search(r'<span[^>]+class="[^"]*remOoDatumTot[^"]*"[^>]*>(.*?)</span>', block, re.I | re.S)
    return clean_text(start.group(1)) if start else "", clean_text(end.group(1)) if end else ""


def parse_records(markup, source_name, details_path):
    pattern = re.compile(
        rf'<a\s+href="(?P<href>[^"]*/{details_path}/Details/[^"]+)"[^>]*>(?P<title><div>.*?</div>)</a>(?P<tail>.*?)'
        rf'(?=<a\s+href="[^"]*/{details_path}/Details/|</div>\s*</div>\s*</div>\s*<script)',
        re.I | re.S,
    )
    records = []
    seen = set()
    for match in pattern.finditer(markup):
        detail_url = urljoin(BASE_URL, html.unescape(match.group("href")))
        title = clean_text(match.group("title"))
        decision_date = parse_decision_date(match.group("tail"))
        inquiry_start, inquiry_end = parse_public_inquiry_dates(match.group("tail"))
        address_text, description, omv, decision_status = split_title(title)
        key = (detail_url, omv, title)
        if key in seen:
            continue
        seen.add(key)
        keyword_matches = sorted(set(m.group(0).lower() for m in DEMOLITION_RE.finditer(title)))
        records.append(
            {
                "source": source_name,
                "detail_url": detail_url,
                "title_text": title,
                "address_text": address_text,
                "description": description,
                "omv_nummer": omv,
                "decision_status": decision_status,
                "decision_date": decision_date,
                "public_inquiry_start": inquiry_start,
                "public_inquiry_end": inquiry_end,
                "demolition_keywords": " | ".join(keyword_matches),
                "demolition_candidate": "yes" if keyword_matches else "no",
            }
        )
    return records


def write_csv(path, records):
    fieldnames = [
        "source",
        "detail_url",
        "title_text",
        "address_text",
        "description",
        "omv_nummer",
        "decision_status",
        "decision_date",
        "public_inquiry_start",
        "public_inquiry_end",
        "demolition_keywords",
        "demolition_candidate",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def main():
    decisions_markup = fetch_url(DECISIONS_URL, RAW_HTML)
    decision_records = parse_records(
        decisions_markup,
        "antwerpen.consultatieomgeving.net/beslissingen",
        "Beslissingen",
    )
    RAW_JSON.write_text(json.dumps(decision_records, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(RAW_CSV, decision_records)
    decision_candidates = [record for record in decision_records if record["demolition_candidate"] == "yes"]
    write_csv(DEMOLITION_CSV, decision_candidates)

    open_markup = fetch_url(OPEN_URL, OPEN_HTML)
    open_records = parse_records(
        open_markup,
        "antwerpen.consultatieomgeving.net/openbare_onderzoeken",
        "OpenbareOnderzoeken",
    )
    OPEN_JSON.write_text(json.dumps(open_records, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(OPEN_CSV, open_records)
    open_candidates = [record for record in open_records if record["demolition_candidate"] == "yes"]
    write_csv(OPEN_DEMOLITION_CSV, open_candidates)

    combined_candidates = decision_candidates + open_candidates
    write_csv(COMBINED_DEMOLITION_CSV, combined_candidates)

    print(f"Fetched: {DECISIONS_URL}")
    print(f"Decision records: {len(decision_records)}")
    print(f"Decision demolition candidates: {len(decision_candidates)}")
    print(f"Fetched: {OPEN_URL}")
    print(f"Public inquiry records: {len(open_records)}")
    print(f"Public inquiry demolition candidates: {len(open_candidates)}")
    print(f"Combined demolition candidates: {len(combined_candidates)}")
    print(f"Raw HTML: {RAW_HTML}")
    print(f"Raw JSON: {RAW_JSON}")
    print(f"Raw CSV: {RAW_CSV}")
    print(f"Demolition CSV: {DEMOLITION_CSV}")
    print(f"Open HTML: {OPEN_HTML}")
    print(f"Open JSON: {OPEN_JSON}")
    print(f"Open CSV: {OPEN_CSV}")
    print(f"Open demolition CSV: {OPEN_DEMOLITION_CSV}")
    print(f"Combined demolition CSV: {COMBINED_DEMOLITION_CSV}")


if __name__ == "__main__":
    main()
