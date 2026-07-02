import csv
import math
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_building_with_distance.csv"
OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets.csv"

CURRENT_DATE = datetime(2026, 7, 2, tzinfo=timezone.utc)

WEIGHTS = {
    "afstand": 0.35,
    "ouderdom": 0.25,
    "deduplicaties": 0.20,
    "area": 0.12,
    "length": 0.08,
}


def clean(value):
    return (value or "").strip()


def parse_status_count(status_telling, status):
    match = re.search(rf"(?:^|\s\|\s){re.escape(status)}:(\d+)(?:\s\|\s|$)", clean(status_telling))
    return int(match.group(1)) if match else 0


def parse_first_float(value):
    for part in clean(value).split("|"):
        part = part.strip()
        if not part:
            continue
        try:
            return float(part)
        except ValueError:
            continue
    return 0.0


def parse_date(value):
    value = clean(value)
    if not value:
        return None
    if value.endswith("+00"):
        value = value[:-3] + "+0000"
    for fmt in ("%Y/%m/%d %H:%M:%S%z", "%Y/%m/%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(value, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            continue
    return None


def clamp(value, minimum=0.0, maximum=100.0):
    return max(minimum, min(maximum, value))


def score_distance(distance_km):
    if distance_km <= 0:
        return 100.0
    # 0 km => 100, 1 km => ~72, 2 km => ~51, 5 km => ~19, 10 km => ~4.
    return clamp(100 * math.exp(-distance_km / 3.0))


def score_age(age_years):
    if age_years <= 0:
        return 0.0
    # Saturates around 8 years so very old records do not dominate everything.
    return clamp((math.log1p(age_years) / math.log1p(8)) * 100)


def score_log(value, cap):
    if value <= 0:
        return 0.0
    return clamp((math.log1p(value) / math.log1p(cap)) * 100)


def priority_label(total_score):
    if total_score >= 75:
        return "A"
    if total_score >= 60:
        return "B"
    if total_score >= 45:
        return "C"
    return "D"


def read_rows():
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_rows(rows, fieldnames):
    OUTPUT_CSV.parent.mkdir(exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    source_rows = read_rows()
    scored = []

    for row in source_rows:
        opname_count = parse_status_count(row.get("reg_status_telling"), "opname")
        kennisgeving_count = parse_status_count(row.get("reg_status_telling"), "kennisgeving")
        if opname_count < 1 and kennisgeving_count < 1:
            continue

        distance = float(clean(row.get("afstand_hemelsbreed_km")) or 999)
        area = parse_first_float(row.get("shape_areas"))
        length = parse_first_float(row.get("shape_lengths"))
        merged_count = int(clean(row.get("samengevoegde_regels")) or 1)
        first_date = parse_date(row.get("eerste_opnamedatum"))
        age_years = max(0.0, (CURRENT_DATE - first_date).days / 365.25) if first_date else 0.0

        distance_score = score_distance(distance)
        age_score = score_age(age_years)
        dedupe_score = score_log(merged_count, 8)
        area_score = score_log(area, 600)
        length_score = score_log(length, 150)

        total_score = (
            distance_score * WEIGHTS["afstand"]
            + age_score * WEIGHTS["ouderdom"]
            + dedupe_score * WEIGHTS["deduplicaties"]
            + area_score * WEIGHTS["area"]
            + length_score * WEIGHTS["length"]
        )

        out = dict(row)
        out["score_totaal"] = f"{total_score:.1f}"
        out["prioriteit"] = priority_label(total_score)
        out["score_afstand"] = f"{distance_score:.1f}"
        out["score_ouderdom"] = f"{age_score:.1f}"
        out["score_deduplicaties"] = f"{dedupe_score:.1f}"
        out["score_area"] = f"{area_score:.1f}"
        out["score_length"] = f"{length_score:.1f}"
        out["opname_count"] = opname_count
        out["kennisgeving_count"] = kennisgeving_count
        out["leegstand_jaren_sinds_eerste_opname"] = f"{age_years:.1f}"
        out["score_uitleg"] = (
            "35% afstand + 25% ouderdom + 20% samengevoegde_regels "
            "+ 12% shape_area + 8% shape_length"
        )
        scored.append(out)

    score_fields = [
        "score_totaal",
        "prioriteit",
        "score_afstand",
        "score_ouderdom",
        "score_deduplicaties",
        "score_area",
        "score_length",
        "opname_count",
        "kennisgeving_count",
        "leegstand_jaren_sinds_eerste_opname",
        "score_uitleg",
    ]
    fieldnames = score_fields + [field for field in source_rows[0].keys() if field not in score_fields]
    scored.sort(key=lambda row: (-float(row["score_totaal"]), float(row["afstand_hemelsbreed_km"]), row["adres"]))
    write_rows(scored, fieldnames)

    print(f"Bronregels: {len(source_rows)}")
    print(f"Na statusfilter: {len(scored)}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
