# WebTools

MVP voor Google Sheets OAuth.

## Eenmalige setup

1. Maak in Google Cloud een OAuth Client ID aan:
   - Application type: **Desktop app**
   - Download het JSON-bestand.
2. Zet dat bestand in deze map als:

```text
credentials.json
```

Als Windows bestandsextensies verbergt, kan het bestand per ongeluk `credentials.json.json` heten. De MVP herkent dat ook, maar hernoemen naar `credentials.json` blijft netter.

3. Installeer dependencies:

```bash
npm install
```

4. Schrijf `Hello World` naar cel `A10` op het tabblad met `gid=1034308374`:

```bash
npm run write:hello
```

Bij de eerste run opent of toont de app een Google-login. Na toestemming wordt `token.json` lokaal opgeslagen voor volgende runs.

## Sheet

De MVP schrijft naar:

```text
https://docs.google.com/spreadsheets/d/1JmxAQlcqFv6CM10Cz3dlbxVqXEh0BXhl7dQQa0Vw420/edit?gid=1034308374
```

## 2dehands caravans sync

Zoekresultaten tot en met 3000 euro ophalen en nieuwe rijen toevoegen:

```bash
npm run sync:caravans
```

Eerst testen zonder te schrijven:

```bash
npm run sync:caravans -- --dry-run
```

Veiligheidskeuzes:

- headless Chromium via Playwright
- afbeeldingen/media/fonts worden geblokkeerd
- geen advertentie-detailpagina's tijdens de zoek-sync
- filtert duidelijke non-caravans voor het schrijven, zoals losse luifels/voortenten, matrassen, stalling, huur, aanhangwagens, airco's en foodtruck/container-only advertenties
- dedupe op bestaande links in kolom A
- cooldown-bestand bij 403/429 in `.crawler-state/`
- standaard zoekfilter: 100 tot 3000 euro, sortering prijs oplopend

## Handmatige caravan review

Start de browser-reviewtool:

```bash
npm run review:caravans
```

Open daarna:

```text
http://localhost:5173
```

De tool:

- zoekt opnieuw op 2dehands
- past de automatische caravan-filter toe
- slaat bestaande Sheet-links over
- toont per kandidaat de echte 2dehands detailpagina
- vult `GROOTTE`, `RIJDT NOG?` en `STAAT` alvast in met suggesties
- schrijft pas naar Google Sheets na `Yes` of sneltoets `y`
- slaat bij `No` of sneltoets `n` lokaal over in `.review-state/`
- navigeert met schermpijlen of `ArrowLeft` / `ArrowRight`
