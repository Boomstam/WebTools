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
