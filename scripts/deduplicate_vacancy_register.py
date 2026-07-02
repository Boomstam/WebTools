import csv
import argparse
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "resources" / "leegstandsregister_stad_antwerpen.csv"
OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_deduplicated.csv"
BUILDING_OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_building_deduplicated.csv"


BASE_FIELDS = [
    "pva_straat",
    "pva_huisnr1",
    "pva_huisnr2",
    "pva_busnr",
    "pnd_district_code",
    "pnd_district",
    "pva_postcode",
]

AGGREGATED_FIELDS = [
    "OBJECTID",
    "pnd_id",
    "reg_entiteit",
    "reg_aard",
    "reg_status",
    "reg_opnamedatum",
    "SHAPE_Length",
    "SHAPE_Area",
]


def clean(value):
    return (value or "").strip()


def unique_join(values):
    seen = []
    for value in values:
        value = clean(value)
        if value and value not in seen:
            seen.append(value)
    return " | ".join(seen)


def all_join(values):
    return " | ".join(clean(value) for value in values if clean(value))


def address_key(row):
    return tuple(clean(row.get(field)) for field in BASE_FIELDS)


def building_key(row):
    return tuple(clean(row.get(field)) for field in BASE_FIELDS if field != "pva_busnr")


def display_address(row, include_bus=True):
    number = clean(row.get("pva_huisnr1"))
    if clean(row.get("pva_huisnr2")):
        number = f"{number}-{clean(row.get('pva_huisnr2'))}"
    bus = f" bus {clean(row.get('pva_busnr'))}" if include_bus and clean(row.get("pva_busnr")) else ""
    return f"{clean(row.get('pva_straat')).title()} {number}{bus}, {clean(row.get('pva_postcode'))} {clean(row.get('pnd_district'))}".strip()


def first_date(values):
    dates = sorted(clean(value) for value in values if clean(value))
    return dates[0] if dates else ""


def last_date(values):
    dates = sorted(clean(value) for value in values if clean(value))
    return dates[-1] if dates else ""


def field_diff_summary(rows):
    changed = []
    for field in AGGREGATED_FIELDS:
        values = {clean(row.get(field)) for row in rows if clean(row.get(field))}
        if len(values) > 1:
            changed.append(field)
    return " | ".join(changed)


def read_rows():
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def deduplicate(rows, level):
    groups = defaultdict(list)
    for row in rows:
        key = building_key(row) if level == "building" else address_key(row)
        groups[key].append(row)

    output_rows = []
    for key, grouped_rows in groups.items():
        base = grouped_rows[0]
        aard_counts = Counter(clean(row.get("reg_aard")) or "onbekend" for row in grouped_rows)
        status_counts = Counter(clean(row.get("reg_status")) or "onbekend" for row in grouped_rows)
        busnrs = [row.get("pva_busnr") for row in grouped_rows]

        output_rows.append(
            {
                "adres": display_address(base, include_bus=level != "building"),
                "pva_straat": clean(base.get("pva_straat")),
                "pva_huisnr1": clean(base.get("pva_huisnr1")),
                "pva_huisnr2": clean(base.get("pva_huisnr2")),
                "pva_busnr": clean(base.get("pva_busnr")),
                "pnd_district_code": clean(base.get("pnd_district_code")),
                "pnd_district": clean(base.get("pnd_district")),
                "pva_postcode": clean(base.get("pva_postcode")),
                "busnummers": unique_join(busnrs),
                "busnummer_count": len({clean(value) for value in busnrs if clean(value)}),
                "samengevoegde_regels": len(grouped_rows),
                "unieke_pnd_ids_count": len({clean(row.get("pnd_id")) for row in grouped_rows if clean(row.get("pnd_id"))}),
                "objectids": unique_join(row.get("OBJECTID") for row in grouped_rows),
                "pnd_ids": unique_join(row.get("pnd_id") for row in grouped_rows),
                "reg_entiteiten": unique_join(row.get("reg_entiteit") for row in grouped_rows),
                "reg_aarden": unique_join(row.get("reg_aard") for row in grouped_rows),
                "reg_aard_telling": " | ".join(f"{name}:{count}" for name, count in aard_counts.most_common()),
                "reg_statussen": unique_join(row.get("reg_status") for row in grouped_rows),
                "reg_status_telling": " | ".join(f"{name}:{count}" for name, count in status_counts.most_common()),
                "eerste_opnamedatum": first_date(row.get("reg_opnamedatum") for row in grouped_rows),
                "laatste_opnamedatum": last_date(row.get("reg_opnamedatum") for row in grouped_rows),
                "alle_opnamedata": unique_join(row.get("reg_opnamedatum") for row in grouped_rows),
                "shape_lengths": unique_join(row.get("SHAPE_Length") for row in grouped_rows),
                "shape_areas": unique_join(row.get("SHAPE_Area") for row in grouped_rows),
                "verschillende_velden": field_diff_summary(grouped_rows),
                "bronregels_volledig": all_join(
                    ",".join(clean(row.get(field)) for field in row.keys()) for row in grouped_rows
                ),
            }
        )

    output_rows.sort(key=lambda row: (row["pva_postcode"], row["pnd_district"], row["pva_straat"], row["pva_huisnr1"], row["pva_busnr"]))
    return output_rows


def write_rows(rows, output_csv):
    output_csv.parent.mkdir(exist_ok=True)
    fieldnames = [
        "adres",
        "pva_straat",
        "pva_huisnr1",
        "pva_huisnr2",
        "pva_busnr",
        "pnd_district_code",
        "pnd_district",
        "pva_postcode",
        "busnummers",
        "busnummer_count",
        "samengevoegde_regels",
        "unieke_pnd_ids_count",
        "objectids",
        "pnd_ids",
        "reg_entiteiten",
        "reg_aarden",
        "reg_aard_telling",
        "reg_statussen",
        "reg_status_telling",
        "eerste_opnamedatum",
        "laatste_opnamedatum",
        "alle_opnamedata",
        "shape_lengths",
        "shape_areas",
        "verschillende_velden",
        "bronregels_volledig",
    ]
    with output_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--level",
        choices=["exact", "building"],
        default="exact",
        help="exact keeps bus numbers separate; building groups all bus numbers at the same building address",
    )
    args = parser.parse_args()

    source_rows = read_rows()
    output_rows = deduplicate(source_rows, args.level)
    output_csv = BUILDING_OUTPUT_CSV if args.level == "building" else OUTPUT_CSV
    write_rows(output_rows, output_csv)
    print(f"Bronregels: {len(source_rows)}")
    print(f"Deduplicated rows: {len(output_rows)}")
    print(f"Samengevoegde extra regels: {len(source_rows) - len(output_rows)}")
    print(f"Level: {args.level}")
    print(f"Output: {output_csv}")


if __name__ == "__main__":
    main()
