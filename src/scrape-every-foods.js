import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SOURCE_URL = 'https://every-foods.nl/collections/all-products';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'web', 'every-foods');
const jsonPath = path.join(outDir, 'products.json');
const htmlPath = path.join(outDir, 'index.html');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function compactLines(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseCardText(text, fallbackName) {
  const lines = compactLines(text);
  const [name = fallbackName] = lines;
  const priceIndexes = lines.map((line, index) => (/€/.test(line) ? index : -1)).filter((index) => index >= 0);
  const priceIndex = priceIndexes[0] ?? -1;
  const lastPriceIndex = priceIndexes.at(-1) ?? priceIndex;
  const nutritionIndex = lines.findIndex((line) => /\bProtein\b.*\bkcal\b/i.test(line));
  const rating = [...lines].reverse().find((line) => /^\d+(?:[,.]\d+)?$/.test(line)) || '';
  const descriptionEnd = nutritionIndex >= 0 ? nutritionIndex : lines.length;
  const shortDescription =
    lines.find((line, index) => index > lastPriceIndex && index < descriptionEnd && !/€/.test(line) && line !== rating) || '';

  return {
    name,
    price: priceIndex >= 0 ? lines[priceIndex] : '',
    shortDescription,
    nutrition: nutritionIndex >= 0 ? lines[nutritionIndex] : '',
    rating,
  };
}

function parseDetailText(text, fallbackName) {
  const lines = compactLines(text);
  const titleIndex = lines.findIndex((line) => line === fallbackName);
  const reviewIndex = lines.findIndex((line) => /\breviews?\b/i.test(line));
  const descriptionStart = reviewIndex >= 0 ? reviewIndex + 1 : titleIndex + 1;
  const shortDetail = lines[descriptionStart] || '';
  const longDescription = lines[descriptionStart + 1] || '';
  const stopIndexCandidates = [
    lines.findIndex((line) => line === 'Write Review'),
    lines.findIndex((line) => line === 'Product Reviews'),
  ].filter((index) => index >= 0);
  const stopIndex = stopIndexCandidates.length ? Math.min(...stopIndexCandidates) : lines.length;
  const usefulLines = lines.slice(Math.max(0, titleIndex), stopIndex);
  const keyIngredientsIndex = usefulLines.findIndex((line) => line === 'Key Ingredients');
  const ingredientsTabIndex = usefulLines.findIndex((line) => line === 'Ingredients');

  return {
    title: lines[titleIndex] || fallbackName,
    detailShortDescription: shortDetail,
    longDescription,
    detailText: usefulLines.join('\n'),
    keyIngredients:
      keyIngredientsIndex >= 0
        ? usefulLines.slice(keyIngredientsIndex + 1, ingredientsTabIndex >= 0 ? ingredientsTabIndex : usefulLines.length).join('\n')
        : '',
  };
}

function keyIngredientNames(text) {
  const lines = compactLines(text);
  const names = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    const looksLikeName = line.length <= 34 && !/[.!?]/.test(line) && next.length > 34;
    if (looksLikeName) names.push(line);
  }
  return names.slice(0, 4);
}

function buildAiRecipeProposition(product) {
  const name = product.name || 'this dish';
  const inspiration = [
    product.detailShortDescription,
    product.longDescription,
    product.shortDescription,
    product.keyIngredients,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = inspiration.toLowerCase();
  const keyNames = keyIngredientNames(product.keyIngredients).join(', ');
  const keyLine = keyNames ? ` Bring in ${keyNames.toLowerCase()} as the main flavor anchors.` : '';
  const method = lower.includes('porridge')
    ? 'Warm oats, quinoa, or buckwheat with plant milk and a pinch of salt until creamy, then fold in fruit, seeds, and a little nut butter for body'
    : lower.includes('smoothie')
      ? 'Blend the frozen fruit or greens with a splash of apple juice, citrus, or plant milk until thick and cold, then adjust with dates or lemon'
      : lower.includes('shot')
        ? 'Blend or juice the herbs, roots, fruit, and citrus very finely, strain if you want a clean shot, and serve it sharply chilled'
        : lower.includes('crumble')
          ? 'Cook the fruit until juicy, cover it with an oat, nut, and seed crumble, then bake until the topping is crisp'
          : lower.includes('ball')
            ? 'Pulse oats, nuts, dates or coconut nectar, spices, and a pinch of salt into a sticky dough, then roll and chill'
            : lower.includes('granola') || lower.includes('müsli') || lower.includes('muesli')
              ? 'Toast oats, nuts, seeds, and spices gently, then cool completely before adding dried fruit or chocolate'
              : 'Prepare the pasta, rice, noodles, or gnocchi separately, then saute the vegetables and aromatics before combining everything with the sauce';
  const flavor = lower.includes('curry')
    ? 'Build the sauce with ginger, garlic, curry spices, and either coconut milk or tomatoes, then balance it with lemon or lime.'
    : lower.includes('pesto') || lower.includes('basil')
      ? 'Blend basil, lemon, olive oil, peas or nuts into a bright green sauce and loosen it with pasta water.'
      : lower.includes('teriyaki') || lower.includes('soy')
        ? 'Make a glossy pan sauce from soy sauce, ginger, sesame, and a little sweetness, then toss everything over high heat.'
        : lower.includes('berry') || lower.includes('mango') || lower.includes('apple')
          ? 'Let the fruit stay bright, balancing sweetness with citrus, warm spice, or a tiny pinch of salt.'
          : 'Season in layers and aim for the texture described on the product card.';

  return `For ${name}, start from the main base and texture described above. ${method}.${keyLine} ${flavor} Finish by tasting for salt, acidity, heat, and creaminess so the final dish lands close to the product's flavor profile.`;
}

function withAiRecipePropositions(products) {
  return products.map((product) => ({
    ...product,
    aiRecipeProposition: buildAiRecipeProposition(product),
  }));
}

function htmlEscapeJson(data) {
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

function buildHtml(payload) {
  const pagePayload = {
    ...payload,
    products: withAiRecipePropositions(payload.products || []),
  };

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Every Foods crawler overzicht</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2328;
      --muted: #667085;
      --line: #d8dee4;
      --paper: #f7f5ef;
      --panel: #ffffff;
      --accent: #176b55;
      --accent-2: #b54708;
      --soft: #edf6f2;
      --shadow: 0 12px 28px rgba(31, 35, 40, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--paper);
      color: var(--ink);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--line);
      background: rgba(247, 245, 239, 0.94);
      backdrop-filter: blur(14px);
    }
    .bar {
      max-width: 1320px;
      margin: 0 auto;
      padding: 16px 20px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: center;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button, input, select {
      font: inherit;
    }
    .btn {
      min-height: 36px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 6px;
      padding: 0 12px;
      cursor: pointer;
    }
    .btn.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 18px 20px 42px;
      display: grid;
      grid-template-columns: minmax(280px, 390px) minmax(0, 1fr);
      gap: 18px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: 1fr 130px;
      gap: 8px;
      margin-bottom: 12px;
    }
    .field {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      background: var(--panel);
      color: var(--ink);
    }
    .list {
      display: grid;
      gap: 10px;
      max-height: calc(100vh - 150px);
      overflow: auto;
      padding-right: 4px;
    }
    .item {
      display: grid;
      grid-template-columns: 74px 1fr;
      gap: 10px;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 8px;
      text-align: left;
      box-shadow: none;
      cursor: pointer;
    }
    .item[aria-selected="true"] {
      outline: 2px solid var(--accent);
      background: var(--soft);
    }
    .thumb {
      width: 74px;
      height: 74px;
      border-radius: 6px;
      object-fit: cover;
      background: #ece7db;
    }
    .item-title {
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .item-desc {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .detail {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-height: calc(100vh - 132px);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(260px, 38%) 1fr;
      gap: 22px;
      padding: 18px;
      border-bottom: 1px solid var(--line);
    }
    .hero img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      background: #ece7db;
    }
    .title-row {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 12px;
    }
    h2 {
      margin: 0;
      font-size: 30px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .price {
      color: var(--accent-2);
      font-weight: 800;
      white-space: nowrap;
    }
    .section {
      padding: 18px;
      border-bottom: 1px solid var(--line);
    }
    .section:last-child {
      border-bottom: 0;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0;
      color: var(--muted);
    }
    p {
      margin: 0;
      line-height: 1.55;
    }
    .long {
      font-size: 18px;
      line-height: 1.55;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-family: inherit;
      line-height: 1.5;
      color: #343942;
    }
    .muted {
      color: var(--muted);
    }
    .fact-grid,
    .nutrition-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }
    .fact,
    .nutrient {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfbf8;
    }
    .fact span,
    .nutrient span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 4px;
    }
    .fact strong,
    .nutrient strong {
      font-size: 18px;
      line-height: 1.2;
    }
    .tag-list,
    .ingredient-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      padding: 0;
      list-style: none;
    }
    .tag-list li,
    .ingredient-list li {
      border: 1px solid var(--line);
      background: #fbfbf8;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      color: #394150;
    }
    .ingredient-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .ingredient-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfbf8;
    }
    .ingredient-card strong {
      display: block;
      margin-bottom: 6px;
      font-size: 16px;
    }
    .recipe {
      background: #f2f7f0;
      border-bottom: 0;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .chip {
      border: 1px solid var(--line);
      background: #fbfbf8;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      color: #394150;
    }
    .empty {
      padding: 22px;
      color: var(--muted);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    @media (max-width: 900px) {
      .bar, main, .hero {
        grid-template-columns: 1fr;
      }
      .actions {
        justify-content: flex-start;
      }
      .list {
        max-height: none;
      }
      .detail {
        min-height: 0;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <div>
        <h1>Every Foods crawler overzicht</h1>
        <div class="meta"><span id="count"></span> gerechten · bron: <a href="${payload.sourceUrl}">${payload.sourceUrl}</a> · crawl: ${payload.crawledAt}</div>
      </div>
      <div class="actions">
        <button class="btn" id="copy-json">Kopieer JSON</button>
        <button class="btn" id="download-json">Download JSON</button>
        <button class="btn primary" id="download-csv">Download CSV</button>
      </div>
    </div>
  </header>
  <main>
    <aside>
      <div class="toolbar">
        <input class="field" id="search" type="search" placeholder="Zoek gerecht of tekst">
        <select class="field" id="sort">
          <option value="site">Sitevolgorde</option>
          <option value="name">Naam A-Z</option>
          <option value="rating">Rating</option>
        </select>
      </div>
      <div class="list" id="list"></div>
    </aside>
    <section class="detail" id="detail"></section>
  </main>
  <script id="products-data" type="application/json">${htmlEscapeJson(pagePayload)}</script>
  <script>
    const payload = JSON.parse(document.getElementById('products-data').textContent);
    const products = payload.products;
    let selectedId = products[0]?.id;

    const listEl = document.getElementById('list');
    const detailEl = document.getElementById('detail');
    const searchEl = document.getElementById('search');
    const sortEl = document.getElementById('sort');
    document.getElementById('count').textContent = products.length;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function visibleProducts() {
      const query = searchEl.value.trim().toLowerCase();
      const rows = products.filter((product) => {
        if (!query) return true;
        return [product.name, product.shortDescription, product.longDescription, product.aiRecipeProposition, product.detailText]
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
      if (sortEl.value === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
      if (sortEl.value === 'rating') rows.sort((a, b) => Number(String(b.rating).replace(',', '.')) - Number(String(a.rating).replace(',', '.')));
      return rows;
    }

    function lines(value) {
      return String(value || '').split('\\n').map((line) => line.trim()).filter(Boolean);
    }

    function unique(values) {
      return [...new Set(values.filter(Boolean))];
    }

    function splitIngredientList(value) {
      const text = String(value || '').trim();
      if (!text) return [];
      const parts = [];
      let depth = 0;
      let current = '';
      for (const char of text) {
        if (char === '(') depth += 1;
        if (char === ')') depth = Math.max(0, depth - 1);
        if (char === ',' && depth === 0) {
          if (current.trim()) parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) parts.push(current.trim());
      return parts;
    }

    function splitGluedIngredients(line) {
      const match = String(line || '').match(/^(.+?[.!?])((?:Cooked|Organic|Water|Coconut|Basmati|Apple|Strawberry|Buckwheat|Oats|Dates|Mango|Cucumber|Tomato|Potato|Rice|Pasta|Red|White|Whole|Gluten-free|Durum|Carrot|Banana|Spinach|Broccoli|SOY|WHEAT).+)$/);
      return match ? { text: match[1], ingredients: match[2] } : { text: line, ingredients: '' };
    }

    function parseKeyIngredients(rawLines) {
      const cleaned = [];
      let ingredientText = '';
      for (const rawLine of rawLines) {
        const split = splitGluedIngredients(rawLine);
        if (split.text) cleaned.push(split.text);
        if (split.ingredients) ingredientText = split.ingredients;
      }

      const cards = [];
      const notes = [];
      for (let index = 0; index < cleaned.length; index += 1) {
        const title = cleaned[index];
        const description = cleaned[index + 1] || '';
        const titleLike = title.length <= 36 && !/[.!?]/.test(title) && description.length > 20;
        if (titleLike) {
          cards.push({ title, description });
          index += 1;
        } else {
          notes.push(title);
        }
      }

      return {
        cards,
        notes,
        ingredients: splitIngredientList(ingredientText),
      };
    }

    function detailSections(product) {
      const detailLines = lines(product.detailText);
      const proteinIndex = detailLines.indexOf('PROTEIN');
      const keyIndex = detailLines.indexOf('Key Ingredients');
      const ingredientsMarkerIndex = detailLines.indexOf('Ingredients');
      const longIndex = detailLines.indexOf(product.longDescription);
      const tagEnd = proteinIndex >= 0 ? proteinIndex : keyIndex >= 0 ? keyIndex : detailLines.length;
      const tags = longIndex >= 0 ? unique(detailLines.slice(longIndex + 1, tagEnd)) : [];

      const nutrition = ['PROTEIN', 'CARBS', 'FAT', 'KCAL'].map((label) => {
        const labelIndex = detailLines.indexOf(label);
        return { label, value: labelIndex >= 0 ? detailLines[labelIndex + 1] || '' : '' };
      }).filter((item) => item.value);

      const keyRaw = keyIndex >= 0
        ? detailLines.slice(keyIndex + 1, ingredientsMarkerIndex >= 0 ? ingredientsMarkerIndex : detailLines.length)
        : lines(product.keyIngredients);
      const keyIngredients = parseKeyIngredients(keyRaw);

      return {
        tags,
        nutrition,
        keyIngredients,
      };
    }

    function renderList() {
      const rows = visibleProducts();
      listEl.innerHTML = rows.length ? rows.map((product) => \`
        <button class="item" data-id="\${escapeHtml(product.id)}" aria-selected="\${product.id === selectedId}">
          <img class="thumb" src="\${escapeHtml(product.image)}" alt="">
          <span>
            <span class="item-title">\${escapeHtml(product.name)}</span>
            <span class="item-desc">\${escapeHtml(product.shortDescription || product.detailShortDescription || '')}</span>
          </span>
        </button>
      \`).join('') : '<div class="empty">Geen gerechten gevonden.</div>';
      for (const button of listEl.querySelectorAll('.item')) {
        button.addEventListener('click', () => {
          selectedId = button.dataset.id;
          render();
        });
      }
    }

    function renderDetail() {
      const product = products.find((row) => row.id === selectedId) || visibleProducts()[0] || products[0];
      if (!product) {
        detailEl.innerHTML = '<div class="empty">Geen data beschikbaar.</div>';
        return;
      }
      selectedId = product.id;
      const sections = detailSections(product);
      const chips = [product.nutrition, product.rating ? \`Rating \${product.rating}\` : '', product.price]
        .filter(Boolean)
        .map((chip) => \`<span class="chip">\${escapeHtml(chip)}</span>\`)
        .join('');
      const descriptions = unique([product.shortDescription, product.detailShortDescription]).map((description) => \`
        <p>\${escapeHtml(description)}</p>
      \`).join('');
      const tags = sections.tags.length ? \`
        <h3>Kenmerken</h3>
        <ul class="tag-list">\${sections.tags.map((tag) => \`<li>\${escapeHtml(tag)}</li>\`).join('')}</ul>
      \` : '';
      const nutrition = sections.nutrition.length ? \`
        <h3>Voedingswaarden</h3>
        <div class="nutrition-grid">
          \${sections.nutrition.map((item) => \`
            <div class="nutrient"><span>\${escapeHtml(item.label)}</span><strong>\${escapeHtml(item.value)}</strong></div>
          \`).join('')}
        </div>
      \` : '';
      const keyIngredients = sections.keyIngredients.cards.length ? \`
        <div class="ingredient-grid">
          \${sections.keyIngredients.cards.map((item) => \`
            <div class="ingredient-card">
              <strong>\${escapeHtml(item.title)}</strong>
              <p>\${escapeHtml(item.description)}</p>
            </div>
          \`).join('')}
        </div>
      \` : sections.keyIngredients.notes.length ? \`
        <p>\${escapeHtml(sections.keyIngredients.notes.join(' '))}</p>
      \` : '<p class="muted">Geen aparte key ingredients gevonden.</p>';
      const ingredientList = sections.keyIngredients.ingredients.length ? \`
        <div class="section">
          <h3>Ingrediëntenlijst</h3>
          <ul class="ingredient-list">\${sections.keyIngredients.ingredients.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join('')}</ul>
        </div>
      \` : '';
      detailEl.innerHTML = \`
        <div class="hero">
          <img src="\${escapeHtml(product.image)}" alt="\${escapeHtml(product.name)}">
          <div>
            <div class="title-row">
              <h2>\${escapeHtml(product.name)}</h2>
              <div class="price">\${escapeHtml(product.price)}</div>
            </div>
            <div class="chips">\${chips}</div>
            <div class="section" style="padding-left:0;padding-right:0;border-bottom:0">
              <h3>In het kort</h3>
              \${descriptions || '<p class="muted">Geen korte beschrijving gevonden.</p>'}
            </div>
          </div>
        </div>
        <div class="section">
          <h3>Beschrijving</h3>
          <p class="long">\${escapeHtml(product.longDescription)}</p>
        </div>
        <div class="section">
          <div class="fact-grid">
            <div class="fact"><span>Prijs</span><strong>\${escapeHtml(product.price || 'n.v.t.')}</strong></div>
            <div class="fact"><span>Rating</span><strong>\${escapeHtml(product.rating || 'n.v.t.')}</strong></div>
            <div class="fact"><span>Bronpositie</span><strong>#\${escapeHtml(product.sourceOrder || '')}</strong></div>
          </div>
          <div style="margin-top:16px">\${tags}</div>
          <div style="margin-top:16px">\${nutrition}</div>
        </div>
        <div class="section">
          <h3>Key ingredients</h3>
          \${keyIngredients}
        </div>
        \${ingredientList}
        <div class="section recipe">
          <h3>AI-proposition: receptidee</h3>
          <p>\${escapeHtml(product.aiRecipeProposition)}</p>
        </div>
      \`;
    }

    function render() {
      renderList();
      renderDetail();
    }

    function download(filename, body, type) {
      const blob = new Blob([body], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }

    function toCsv(rows) {
      const headers = ['name', 'image', 'price', 'rating', 'shortDescription', 'detailShortDescription', 'longDescription', 'aiRecipeProposition', 'nutrition'];
      const quote = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
      return [headers.join(','), ...rows.map((row) => headers.map((header) => quote(row[header])).join(','))].join('\\n');
    }

    searchEl.addEventListener('input', render);
    sortEl.addEventListener('change', render);
    document.getElementById('copy-json').addEventListener('click', async () => {
      await navigator.clipboard.writeText(JSON.stringify(products, null, 2));
    });
    document.getElementById('download-json').addEventListener('click', () => {
      download('every-foods-products.json', JSON.stringify(products, null, 2), 'application/json');
    });
    document.getElementById('download-csv').addEventListener('click', () => {
      download('every-foods-products.csv', toCsv(products), 'text/csv');
    });

    render();
  </script>
</body>
</html>`;
}

async function run() {
  await mkdir(outDir, { recursive: true });

  if (process.argv.includes('--render-existing')) {
    const payload = JSON.parse(await readFile(jsonPath, 'utf8'));
    const nextPayload = {
      ...payload,
      products: withAiRecipePropositions(payload.products || []),
    };
    await writeFile(jsonPath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8');
    await writeFile(htmlPath, buildHtml(nextPayload), 'utf8');
    console.log(`Rendered ${nextPayload.products.length} products`);
    console.log(jsonPath);
    console.log(htmlPath);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  page.setDefaultTimeout(30000);

  await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(750);

  const cards = await page.evaluate(() => {
    const seen = new Set();
    const result = [];
    const buttons = Array.from(document.querySelectorAll('button[aria-label^="View details for"]'));
    for (const button of buttons) {
      const name = button.getAttribute('aria-label').replace('View details for ', '').trim();
      if (seen.has(name)) continue;
      seen.add(name);
      const id = `product-${result.length}`;
      button.setAttribute('data-scrape-id', id);
      const image = button.querySelector('img')?.currentSrc || button.querySelector('img')?.src || '';
      result.push({ id, name, text: button.innerText, image });
    }
    return result;
  });

  const products = [];
  for (const [index, card] of cards.entries()) {
    const cardData = parseCardText(card.text, card.name);
    const button = page.locator(`[data-scrape-id="${card.id}"]`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const productDialog = page.locator('[role="dialog"][aria-modal="true"][class*="drawer-panel"]').first();
    await productDialog.waitFor({ state: 'visible' });
    await sleep(400);

    const detail = await productDialog.evaluate((dialog, fallbackName) => {
      return {
        text: dialog?.innerText || '',
        image: dialog?.querySelector('img')?.currentSrc || dialog?.querySelector('img')?.src || '',
        sourceTitle: dialog?.getAttribute('aria-label') || fallbackName,
      };
    }, card.name);

    const detailData = parseDetailText(detail.text, card.name);
    products.push({
      id: card.id,
      sourceOrder: index + 1,
      sourceUrl: SOURCE_URL,
      name: cardData.name || detailData.title || card.name,
      image: detail.image || card.image,
      price: cardData.price,
      rating: cardData.rating,
      shortDescription: cardData.shortDescription,
      nutrition: cardData.nutrition,
      detailShortDescription: detailData.detailShortDescription,
      longDescription: detailData.longDescription,
      keyIngredients: detailData.keyIngredients,
      detailText: detailData.detailText,
    });

    await page.keyboard.press('Escape');
    await productDialog.waitFor({ state: 'detached', timeout: 10000 }).catch(async () => {
      await page.getByLabel('Close meal details').click();
    });
    console.log(`${index + 1}/${cards.length} ${card.name}`);
  }

  await browser.close();

  const payload = {
    sourceUrl: SOURCE_URL,
    crawledAt: new Date().toISOString(),
    products: withAiRecipePropositions(products),
  };

  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, buildHtml(payload), 'utf8');
  console.log(`\nSaved ${products.length} products`);
  console.log(jsonPath);
  console.log(htmlPath);
}

run().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
