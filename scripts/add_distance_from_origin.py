import argparse
import csv
import hashlib
import json
import math
import time
from pathlib import Path
from urllib.parse import urlencode

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_building_deduplicated.csv"
DEFAULT_OUTPUT = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_building_with_distance.csv"
CACHE_DIR = ROOT / "outputs" / "geocode_cache_vlaanderen"

ORIGIN_QUERY = "Auwersstraat 66, 2600 Antwerpen"
API_URL = "https://geo.api.vlaanderen.be/geolocation/v4/Location"


def clean(value):
    return (value or "").strip()


def title_street(value):
    return clean(value).title()


def cache_key(query, type_filter):
    raw = f"{query}|{type_filter or ''}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def geocode_request(query, type_filter="Housenumber", refresh=False):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{cache_key(query, type_filter)}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))

    params = {"q": query, "c": 1}
    if type_filter:
        params["type"] = type_filter
    response = requests.get(
        f"{API_URL}?{urlencode(params)}",
        headers={"Accept": "application/json", "User-Agent": "WebTools-distance-enrichment/1.0"},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    time.sleep(0.05)
    return payload


def first_result(payload):
    results = payload.get("LocationResult") or []
    return results[0] if results else None


def geocode_with_fallbacks(row, refresh=False):
    street = title_street(row.get("pva_straat"))
    house1 = clean(row.get("pva_huisnr1"))
    house2 = clean(row.get("pva_huisnr2"))
    postcode = clean(row.get("pva_postcode"))

    number_range = f"{house1}-{house2}" if house1 and house2 else house1
    attempts = []
    if number_range:
        attempts.append((f"{street} {number_range}, {postcode} Antwerpen", "Housenumber", "volledig_huisnummer"))
    if house2 and house1:
        attempts.append((f"{street} {house1}, {postcode} Antwerpen", "Housenumber", "eerste_huisnummer"))
    attempts.append((f"{street}, {postcode} Antwerpen", None, "straat_postcode"))

    errors = []
    for query, type_filter, strategy in attempts:
        try:
            payload = geocode_request(query, type_filter=type_filter, refresh=refresh)
            result = first_result(payload)
            if result:
                return result, query, strategy, ""
        except Exception as exc:
            errors.append(f"{query}: {exc}")
    return None, "", "geen_match", " | ".join(errors)


def match_quality(row, result, strategy):
    if not result:
        return "geen"
    result_street = clean(result.get("Thoroughfarename")).lower()
    result_house = clean(result.get("Housenumber")).lower()
    result_zip = clean(result.get("Zipcode"))
    street = clean(row.get("pva_straat")).lower()
    house1 = clean(row.get("pva_huisnr1")).lower()
    house2 = clean(row.get("pva_huisnr2")).lower()
    postcode = clean(row.get("pva_postcode"))

    street_ok = result_street == street
    house_ok = result_house in {house1, f"{house1}-{house2}".strip("-")}
    zip_ok = result_zip == postcode

    if strategy in {"volledig_huisnummer", "eerste_huisnummer"} and street_ok and house_ok and zip_ok:
        return "hoog"
    if strategy == "eerste_huisnummer" and street_ok and zip_ok:
        return "hoog_range_fallback"
    if street_ok and zip_ok:
        return "middel"
    return "laag"


def distance_km(origin_result, result):
    origin_loc = origin_result["Location"]
    loc = result["Location"]
    dx = float(loc["X_Lambert72"]) - float(origin_loc["X_Lambert72"])
    dy = float(loc["Y_Lambert72"]) - float(origin_loc["Y_Lambert72"])
    return math.hypot(dx, dy) / 1000


def bucket(distance):
    if distance == "":
        return ""
    value = float(distance)
    if value < 1:
        return "0-1 km"
    if value < 2:
        return "1-2 km"
    if value < 5:
        return "2-5 km"
    if value < 10:
        return "5-10 km"
    return "10+ km"


def read_rows(input_csv):
    with input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(output_csv, rows, fieldnames):
    output_csv.parent.mkdir(exist_ok=True)
    with output_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    origin_payload = geocode_request(ORIGIN_QUERY, refresh=args.refresh)
    origin_result = first_result(origin_payload)
    if not origin_result:
        raise RuntimeError(f"Origin not geocoded: {ORIGIN_QUERY}")

    rows = read_rows(args.input)
    enriched = []
    for index, row in enumerate(rows, start=1):
        result, query, strategy, error = geocode_with_fallbacks(row, refresh=args.refresh)
        output = dict(row)
        output["afstand_origin_adres"] = ORIGIN_QUERY
        output["geocode_query"] = query
        output["geocode_strategy"] = strategy
        output["geocode_status"] = "gevonden" if result else "niet_gevonden"
        output["geocode_quality"] = match_quality(row, result, strategy)
        output["geocode_formatted_address"] = clean(result.get("FormattedAddress")) if result else ""
        output["geocode_location_type"] = clean(result.get("LocationType")) if result else ""
        output["lat_wgs84"] = result["Location"].get("Lat_WGS84", "") if result else ""
        output["lon_wgs84"] = result["Location"].get("Lon_WGS84", "") if result else ""
        output["x_lambert72"] = result["Location"].get("X_Lambert72", "") if result else ""
        output["y_lambert72"] = result["Location"].get("Y_Lambert72", "") if result else ""
        if result:
            dist = distance_km(origin_result, result)
            output["afstand_hemelsbreed_km"] = f"{dist:.3f}"
            output["afstand_bucket"] = bucket(dist)
        else:
            output["afstand_hemelsbreed_km"] = ""
            output["afstand_bucket"] = ""
        output["geocode_error"] = error
        enriched.append(output)
        if index % 50 == 0 or not result:
            print(f"{index}/{len(rows)} {output['geocode_status']} {output.get('adres')} {output['afstand_hemelsbreed_km']}", flush=True)

    distance_fields = [
        "afstand_origin_adres",
        "geocode_query",
        "geocode_strategy",
        "geocode_status",
        "geocode_quality",
        "geocode_formatted_address",
        "geocode_location_type",
        "lat_wgs84",
        "lon_wgs84",
        "x_lambert72",
        "y_lambert72",
        "afstand_hemelsbreed_km",
        "afstand_bucket",
        "geocode_error",
    ]
    fieldnames = list(rows[0].keys()) + [field for field in distance_fields if field not in rows[0]]
    enriched.sort(key=lambda row: (float(row["afstand_hemelsbreed_km"]) if row["afstand_hemelsbreed_km"] else 999999, row.get("adres", "")))
    write_rows(args.output, enriched, fieldnames)

    found = sum(1 for row in enriched if row["geocode_status"] == "gevonden")
    print(f"Rows: {len(enriched)}")
    print(f"Geocoded: {found}")
    print(f"Not geocoded: {len(enriched) - found}")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
