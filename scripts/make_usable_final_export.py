import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets_final.csv"
OUTPUT_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_usable_final.csv"


FRONT_COLUMNS = [
    "adres",
    "score_totaal",
    "prioriteit",
    "mogelijk_bevel_tot_afbraak",
    "score_totaal_origineel",
    "score_afbraak_boost",
    "afstand_hemelsbreed_km",
    "afstand_bucket",
    "leegstand_jaren_sinds_eerste_opname",
    "opname_count",
    "kennisgeving_count",
    "samengevoegde_regels",
    "unieke_pnd_ids_count",
    "reg_status_telling",
    "reg_aard_telling",
    "reg_entiteiten",
    "pva_straat",
    "pva_huisnr1",
    "pva_huisnr2",
    "pva_postcode",
    "pnd_district",
    "busnummers",
    "busnummer_count",
    "eerste_opnamedatum",
    "laatste_opnamedatum",
    "shape_areas",
    "shape_lengths",
    "score_afstand",
    "score_ouderdom",
    "score_deduplicaties",
    "score_area",
    "score_length",
]

AFBRAAK_CONTEXT_COLUMNS = [
    "afbraak_match_count",
    "afbraak_match_type",
    "afbraak_match_reasons",
    "afbraak_omv_nummers",
    "afbraak_statussen",
    "afbraak_datums",
    "afbraak_adres_bron",
    "afbraak_omschrijving",
    "afbraak_bronnen",
    "afbraak_detail_urls",
]

GEO_CONTEXT_COLUMNS = [
    "geocode_quality",
    "geocode_formatted_address",
    "lat_wgs84",
    "lon_wgs84",
    "x_lambert72",
    "y_lambert72",
]

DUMP_COLUMNS = [
    "objectids",
    "pnd_ids",
    "pva_busnr",
    "pnd_district_code",
    "reg_statussen",
    "reg_aarden",
    "alle_opnamedata",
    "verschillende_velden",
    "afstand_origin_adres",
    "geocode_query",
    "geocode_strategy",
    "geocode_status",
    "geocode_location_type",
    "geocode_error",
    "score_uitleg",
    "bronregels_volledig",
]


def read_rows():
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader), list(reader.fieldnames or [])


def ordered_fieldnames(existing_fields):
    ordered = []
    for group in [FRONT_COLUMNS, AFBRAAK_CONTEXT_COLUMNS, GEO_CONTEXT_COLUMNS, DUMP_COLUMNS]:
        for field in group:
            if field in existing_fields and field not in ordered:
                ordered.append(field)
    for field in existing_fields:
        if field not in ordered:
            ordered.append(field)
    return ordered


def main():
    rows, existing_fields = read_rows()
    fieldnames = ordered_fieldnames(existing_fields)

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Rows: {len(rows)}")
    print(f"Columns: {len(fieldnames)}")
    print(f"Output: {OUTPUT_CSV}")
    print("First columns:")
    for index, field in enumerate(fieldnames[:35], start=1):
        print(f"{index}: {field}")


if __name__ == "__main__":
    main()
