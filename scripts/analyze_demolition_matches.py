import csv
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VACANCY_CSV = ROOT / "outputs" / "leegstandsregister_stad_antwerpen_scored_targets.csv"
DEMOLITION_CSV = ROOT / "outputs" / "demolition_sources" / "consultatieomgeving_combined_sloop_candidates.csv"
OUTPUT_CSV = ROOT / "outputs" / "demolition_sources" / "demolition_candidate_matches_to_vacancy.csv"


def clean(value):
    return (value or "").strip()


def norm(value):
    value = clean(value).lower()
    value = "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch))
    value = value.replace("ij", "y")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def number_tokens(value):
    tokens = set()
    for raw in re.findall(r"\b\d+[a-z]?(?:-\d+[a-z]?)?\b", clean(value).lower()):
        first_number = re.match(r"\d+", raw)
        if first_number and 1000 <= int(first_number.group(0)) <= 2999:
            continue
        tokens.add(raw)
        if "-" in raw:
            first, second = raw.split("-", 1)
            tokens.add(first)
            tokens.add(second)
            if first.isdigit() and re.match(r"^\d+", second):
                try:
                    for number in range(int(first), int(re.match(r"^\d+", second).group(0)) + 1):
                        tokens.add(str(number))
                except ValueError:
                    pass
    return tokens


def read_csv(path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def score_match(vacancy, candidate):
    candidate_text = " ".join([candidate.get("address_text", ""), candidate.get("title_text", ""), candidate.get("description", "")])
    candidate_address = candidate.get("address_text", "")
    candidate_norm = norm(candidate_address)
    street_norm = norm(vacancy.get("pva_straat"))
    vacancy_numbers = number_tokens(" ".join([vacancy.get("pva_huisnr1", ""), vacancy.get("pva_huisnr2", "")]))
    candidate_numbers = number_tokens(candidate_address)

    score = 0
    reasons = []
    if street_norm and street_norm in candidate_norm:
        score += 60
        reasons.append("straat")
    overlap = vacancy_numbers & candidate_numbers
    if overlap:
        score += 35
        reasons.append(f"huisnr:{'/'.join(sorted(overlap))}")
    postcode = clean(vacancy.get("pva_postcode"))
    if postcode and re.search(rf"\b{re.escape(postcode)}\b", candidate_text):
        score += 10
        reasons.append("postcode")
    return score, reasons


def main():
    vacancies = read_csv(VACANCY_CSV)
    candidates = read_csv(DEMOLITION_CSV)
    rows = []
    for candidate in candidates:
        best = []
        for vacancy in vacancies:
            score, reasons = score_match(vacancy, candidate)
            if score >= 70:
                best.append((score, reasons, vacancy))
        best.sort(key=lambda item: item[0], reverse=True)
        if not best:
            rows.append(
                {
                    "match_status": "geen_match",
                    "match_score": "",
                    "match_reasons": "",
                    "vacancy_adres": "",
                    "vacancy_score_totaal": "",
                    "vacancy_prioriteit": "",
                    "candidate_address_text": candidate.get("address_text", ""),
                    "candidate_description": candidate.get("description", ""),
                    "candidate_omv_nummer": candidate.get("omv_nummer", ""),
                    "candidate_decision_status": candidate.get("decision_status", ""),
                    "candidate_decision_date": candidate.get("decision_date", ""),
                    "candidate_public_inquiry_start": candidate.get("public_inquiry_start", ""),
                    "candidate_public_inquiry_end": candidate.get("public_inquiry_end", ""),
                    "candidate_source": candidate.get("source", ""),
                    "candidate_detail_url": candidate.get("detail_url", ""),
                }
            )
            continue

        for score, reasons, vacancy in best[:5]:
            rows.append(
                {
                    "match_status": "mogelijke_match" if score < 100 else "sterke_match",
                    "match_score": score,
                    "match_reasons": " | ".join(reasons),
                    "vacancy_adres": vacancy.get("adres", ""),
                    "vacancy_score_totaal": vacancy.get("score_totaal", ""),
                    "vacancy_prioriteit": vacancy.get("prioriteit", ""),
                    "candidate_address_text": candidate.get("address_text", ""),
                    "candidate_description": candidate.get("description", ""),
                    "candidate_omv_nummer": candidate.get("omv_nummer", ""),
                    "candidate_decision_status": candidate.get("decision_status", ""),
                    "candidate_decision_date": candidate.get("decision_date", ""),
                    "candidate_public_inquiry_start": candidate.get("public_inquiry_start", ""),
                    "candidate_public_inquiry_end": candidate.get("public_inquiry_end", ""),
                    "candidate_source": candidate.get("source", ""),
                    "candidate_detail_url": candidate.get("detail_url", ""),
                }
            )

    fieldnames = [
        "match_status",
        "match_score",
        "match_reasons",
        "vacancy_adres",
        "vacancy_score_totaal",
        "vacancy_prioriteit",
        "candidate_address_text",
        "candidate_description",
        "candidate_omv_nummer",
        "candidate_decision_status",
        "candidate_decision_date",
        "candidate_public_inquiry_start",
        "candidate_public_inquiry_end",
        "candidate_source",
        "candidate_detail_url",
    ]
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Candidates: {len(candidates)}")
    print(f"Match rows: {len(rows)}")
    print(f"Output: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
