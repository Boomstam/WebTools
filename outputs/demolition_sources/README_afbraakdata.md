# Afbraak-/sloopdata verkenning

Bronnen opgehaald op 2026-07-02:

- `consultatieomgeving_beslissingen_records.csv`: recente Antwerpse bekendmakingen van beslissingen omgevingsvergunningen.
- `consultatieomgeving_sloop_candidates.csv`: subset uit beslissingen met sloop/afbraak-keywords.
- `consultatieomgeving_openbare_onderzoeken_records.csv`: lopende openbare onderzoeken.
- `consultatieomgeving_openbare_onderzoeken_sloop_candidates.csv`: subset uit openbare onderzoeken met sloop/afbraak-keywords.
- `consultatieomgeving_combined_sloop_candidates.csv`: gecombineerde sloopkandidaten uit beide bronnen.
- `demolition_candidate_matches_to_vacancy.csv`: aparte match-analyse tegen de leegstandstargetlijst.

Tellingen:

- Beslissingen: 346 records, 14 sloopkandidaten.
- Openbare onderzoeken: 95 records, 13 sloopkandidaten.
- Gecombineerd: 27 sloopkandidaten.

Belangrijke beperking:

Deze bronnen tonen recente beslissingen en lopende openbare onderzoeken, niet noodzakelijk de volledige historische vergunningendatabank. Het is dus bruikbaar als actueel signaal, maar niet als sluitend bewijs dat een pand wel of niet voor afbraak bestemd is.

Matchadvies:

- Voeg een hard `afbraak_signaal` alleen toe bij exacte adresmatch: straat + huisnummer/range + postcode.
- De huidige match-analyse vond geen sterke exacte matches met de leegstandstargetlijst.
- Straat/postcode-overlaps bestaan wel, maar zijn te zwak voor automatische invoeging. Bewaar die als `mogelijke_afbraak_straatmatch` of als reviewlijst.

Aanbevolen kolommen bij latere invoeging:

- `afbraak_signaal`: `ja`, `mogelijk`, `nee`
- `afbraak_confidence`: `hoog`, `middel`, `laag`
- `afbraak_bron`: bronnaam
- `afbraak_omv_nummer`
- `afbraak_status`: bijvoorbeeld `GOEDGEKEURD`, `GEWEIGERD`, of leeg bij lopend openbaar onderzoek
- `afbraak_datum`: beslissingsdatum of start openbaar onderzoek
- `afbraak_omschrijving`
- `afbraak_detail_url`

Voor deze run:

- Automatisch invoegen in de hoofd-CSV is niet verstandig.
- Beste volgende stap is de 27 sloopkandidaten apart bekijken of matchen via geocoding/perceeldata als er later kadastrale perceelnummers beschikbaar zijn.
