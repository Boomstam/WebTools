# Caravan Search Flow Notes

This flow worked well for 2dehands caravan discovery:

1. Use a headless browser to load the normal 2dehands search page with the user-facing hash filters.
2. Let the page make its own `/lrp/api/search` call, then reuse that browser context for paginated offsets.
3. Keep the run respectful:
   - block images, media, fonts and common tracking hosts
   - do not open detail pages during bulk search
   - use a small fixed number of paginated search calls
   - keep a 403/429 cooldown file
4. Filter before writing to Google Sheets.
5. Dedupe against existing Sheet links.
6. Only append rows after the automatic filter has run.

Manual review iteration:

1. Present filtered candidates one by one.
2. Show the real 2dehands detail page.
3. Pre-fill editable fields from listing text.
4. Append to Google Sheets only after explicit user confirmation.
