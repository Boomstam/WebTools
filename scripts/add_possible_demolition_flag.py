import csv
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets.csv"
MATCHES_CSV = ROOT / "outputs" / "demolition_sources" / "demolition_candidate_matches_to_vacancy.csv"
OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets_with_possible_demolition.csv"


def clean(value):
    return (value or "").strip()


def read_csv(path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def unique_join(values):
    seen = []
    for value in values:
        value = clean(value)
        if value and value not in seen:
            seen.append(value)
    return " | ".join(seen)


def main():
    target_rows = read_csv(INPUT_CSV)
    match_rows = read_csv(MATCHES_CSV)

    matches_by_address = defaultdict(list)
    for match in match_rows:
        if clean(match.get("match_status")) == "geen_match":
            continue
        vacancy_address = clean(match.get("vacancy_adres"))
        if vacancy_address:
            matches_by_address[vacancy_address].append(match)

    enriched = []
    for row in target_rows:
        address = clean(row.get("adres"))
        matches = matches_by_address.get(address, [])
        out = dict(row)
        out["mogelijk_bevel_tot_afbraak"] = "JA" if matches else "NEE"
        out["afbraak_match_count"] = len(matches)
        out["afbraak_match_type"] = unique_join(match.get("match_status") for match in matches)
        out["afbraak_match_reasons"] = unique_join(match.get("match_reasons") for match in matches)
        out["afbraak_omv_nummers"] = unique_join(match.get("candidate_omv_nummer") for match in matches)
        out["afbraak_statussen"] = unique_join(match.get("candidate_decision_status") for match in matches)
        out["afbraak_datums"] = unique_join(
            match.get("candidate_decision_date") or match.get("candidate_public_inquiry_start") for match in matches
        )
        out["afbraak_bronnen"] = unique_join(match.get("candidate_source") for match in matches)
        out["afbraak_adres_bron"] = unique_join(match.get("candidate_address_text") for match in matches)
        out["afbraak_omschrijving"] = unique_join(match.get("candidate_description") for match in matches)
        out["afbraak_detail_urls"] = unique_join(match.get("candidate_detail_url") for match in matches)
        enriched.append(out)

    added_fields = [
        "mogelijk_bevel_tot_afbraak",
        "afbraak_match_count",
        "afbraak_match_type",
        "afbraak_match_reasons",
        "afbraak_omv_nummers",
        "afbraak_statussen",
        "afbraak_datums",
        "afbraak_bronnen",
        "afbraak_adres_bron",
        "afbraak_omschrijving",
        "afbraak_detail_urls",
    ]
    fieldnames = added_fields + [field for field in target_rows[0].keys() if field not in added_fields]
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(enriched)

    print(f"Input rows: {len(target_rows)}")
    print(f"Rows flagged JA: {sum(1 for row in enriched if row['mogelijk_bevel_tot_afbraak'] == 'JA')}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
