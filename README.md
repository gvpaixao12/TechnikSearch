# TechnikSearch

AI-powered car search and recommendation tool. Describe what you're looking for in plain language ("family SUV, automatic, up to R$120k") and TechnikSearch classifies the request, matches it against a vehicle catalog, and enriches each result with images and up-to-date **FIPE** prices — all shown in a visual comparison panel.

## Features

- **Natural-language search** — an LLM turns free-text queries into structured filters and intent.
- **Smart matching** — fuzzy search over the catalog with [Fuse.js](https://fusejs.io/) plus a recommendation layer.
- **FIPE price lookup** — fetches current Brazilian reference prices, with a local cache to avoid re-querying on every search.
- **Image pipeline** — resolves, validates and optimizes vehicle images (via [sharp](https://sharp.pixelplumbing.com/)), with caching.
- **Visual panel** — a results/comparison UI (`Technik - Painel Visual.html`, `results.jsx`, `design-canvas.jsx`).

## Tech stack

- **Backend:** Node.js + Express (ES modules)
- **AI:** OpenAI API for query classification & recommendations
- **Data:** Supabase (catalog + cached consultations), Fuse.js for search
- **Images:** sharp, custom image providers/validator
- **Tooling:** Playwright (scraping/catalog build scripts)

## Project structure

```
server/
├── index.js            # Express entry point
├── classify.js         # LLM query classification
├── match.js            # catalog matching
├── recommend.js        # recommendation logic
├── fipe.js             # FIPE price lookup
├── image*.js           # image cache / providers / validation
├── catalog.js          # catalog access
├── data/catalog.json   # vehicle catalog
└── scripts/            # catalog & image build / diagnostics
data.js, results.jsx, design-canvas.jsx, brand-styles.css   # front-end panel
```

## Getting started

```bash
cd server
npm install
cp .env.example .env   # add OpenAI + Supabase keys
npm run dev            # starts the API (node --watch index.js)
```

> Requires `OPENAI_API_KEY` and Supabase credentials. See `server/scripts/` for building the catalog and pre-caching images.

## Status

Work in progress / personal project.
