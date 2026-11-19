# SBMF Car Transport TMS

A transport management system for small car carriers in Europe: orders per VIN, trips, load planning, handover with photos/damage/signature, eCMR copies and invoicing.

## Files
- `index.html` – the TMS (home screen and all modules)
- `app.js` – the TMS logic
- `cars-db.js` – car database (500 models, approximate dimensions – verify)
- `planner.html` – the car load planner, opened inside the TMS

## Run it
Put all four files in the root of a GitHub repository, then go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at `https://<your-username>.github.io/<repo-name>/`.

Opening `index.html` straight from your computer (file://) may block the load planner; use GitHub Pages or a local server (`python3 -m http.server`).

## Data
On GitHub Pages, data is saved in the browser you use (localStorage). Use **Settings → Download backup** to keep a copy or move it to another device, and **Restore backup** to load it.

## Status
MVP. Load-planner layouts exist for the Lohr Eurolohr 200 (low and high cab) only. The eCMR is a PDF copy, not an eFTI-certified submission.
