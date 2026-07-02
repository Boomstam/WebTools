import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets_with_possible_demolition.csv"
OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets_final.csv"

DEMOLITION_BOOST = 1000.0


def clean(value):
    return (value or "").strip()


def read_rows():
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def priority_label(score, demolition_flag):
    if demolition_flag == "JA":
        return "A_AFBR"
    if score >= 75:
        return "A"
    if score >= 60:
        return "B"
    if score >= 45:
        return "C"
    return "D"


def main():
    rows = read_rows()
    enriched = []
    for row in rows:
        base_score = float(clean(row.get("score_totaal")) or 0)
        demolition_flag = clean(row.get("mogelijk_bevel_tot_afbraak"))
        boost = DEMOLITION_BOOST if demolition_flag == "JA" else 0.0
        final_score = base_score + boost
        out = dict(row)
        out["score_totaal_origineel"] = f"{base_score:.1f}"
        out["score_afbraak_boost"] = f"{boost:.1f}"
        out["score_totaal"] = f"{final_score:.1f}"
        out["prioriteit"] = priority_label(final_score, demolition_flag)
        enriched.append(out)

    enriched.sort(
        key=lambda row: (
            clean(row.get("mogelijk_bevel_tot_afbraak")) != "JA",
            -float(row.get("score_totaal") or 0),
            -float(row.get("score_totaal_origineel") or 0),
            row.get("adres", ""),
        )
    )

    added_fields = ["score_totaal_origineel", "score_afbraak_boost"]
    fieldnames = []
    for field in rows[0].keys():
        fieldnames.append(field)
        if field == "score_totaal":
            fieldnames.extend(added_fields)
    for field in added_fields:
        if field not in fieldnames:
            fieldnames.append(field)

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(enriched)

    print(f"Input rows: {len(rows)}")
    print(f"JA rows: {sum(1 for row in enriched if row['mogelijk_bevel_tot_afbraak'] == 'JA')}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
