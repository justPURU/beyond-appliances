# Beyond Appliances: Category Performance Dashboard

A decision-ready sales dashboard for a Category Manager covering **Amazon (Amazon PI)** and **Flipkart (Flipkart Iris)**. It reads the raw multi-tab workbook straight from **Google Sheets** (live sync), cleans and joins it in the browser, and is hosted free on **GitHub Pages**.

**Contents:** KPI tiles (GMV, Units, ASP, TACOS, DRR, each vs previous period and YoY) · TY vs LY trend with daily/weekly/monthly toggle · platform and category contribution · consolidated ad spend and TACOS · geography (Amazon city, state view for both platforms) · age bands · sortable, filterable model/SKU table · data-health panel · written insights ([INSIGHTS.md](INSIGHTS.md)).

---

## 1. Publish on GitHub Pages (one-time)

1. In the repo go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source = Deploy from a branch**. Pick the branch that holds this code (e.g. `main`) and folder **`/ (root)`**, then **Save**.
3. After about a minute the dashboard is live at `https://<your-github-username>.github.io/beyond-appliances/`.

There is no build step. It is a static site (`index.html` + `assets/`), so every push is live straight away.

## 2. Live sync with the Google Sheet (one-time)

The dashboard pulls every tab with Google's public CSV endpoint on page load and **every 5 minutes** while open. There is also a manual ↻ refresh button. The header pill shows **Live · synced hh:mm** or **Snapshot**.

1. **Make it a native Google Sheet.** The link shared (`1GDtwOmny7nG1QyAj1yOs45FAneOBKjal`) looks like an uploaded **.xlsx** opened in Sheets. Google can't serve those as CSV. Open it, choose **File → Save as Google Sheets**, and use the **new** sheet from then on. Its URL will have a different, longer ID.
2. **Share it read-only.** Click **Share → General access → Anyone with the link → Viewer**.
3. **Point the dashboard at it.** Put the ID (the part between `/d/` and `/edit` in the URL) in [`assets/config.js`](assets/config.js) → `sheetId`, then commit. To test without editing, open `…/beyond-appliances/?sheet=<ID>`.
4. Keep the tab names exactly: `SKU_Master`, `Sales`, `Locations`, `Age`, `Spends`. You can rename them in `config.js`.

**Adding data:** append rows to the bottom of any tab in the same column layout. The next sync (≤5 min, or ↻) picks them up. Period presets such as "Last full month" and "Month to date" are relative to the **latest date in the data**, so they roll forward on their own. New SKUs must also be added to `SKU_Master`. Until then they show up flagged as **unmapped** and are never dropped.

> Tip: keep the `Date` column formatted as **Plain text** (Format → Number → Plain text) before pasting. That stops Sheets from re-interpreting `09/01/2026` in your locale.

If the live sheet can't be reached, the dashboard falls back to the bundled snapshot in [`data/`](data) and shows a banner explaining why. It never mixes live and snapshot data. Force a mode with `?source=snapshot` or `config.source`.

## 3. Why this tool (vs Looker Studio / Power BI)

| Need from the brief | Looker Studio | This build (HTML + ECharts on GitHub Pages) |
|---|---|---|
| ASIN ↔ FSN unification, date-format repair, name cleaning | Needs a pre-cleaned sheet or blended sources (brittle with 5 tabs) | Done in code on every sync, so appended raw rows get the same cleaning |
| Prev-period **and** YoY on every tile | Needs a comparison date range per chart, no “prev + YoY” on one scorecard | Time-shifted self-join for both windows, with coverage flags (“no LY data”, “partial”) |
| TACOS with campaign-level spend under product filters | Not possible without a modelling layer | GMV-weighted allocation of SB/Display/DSP spend, exact at total level |
| Data-health flags (missing cost, FK city gap, zero returns) | Manual text boxes | Computed from the data and re-checked on every sync |
| Live from Google Sheets, free hosting, shareable link | ✓ | ✓ (public CSV endpoint + GitHub Pages) |

## 4. Data model & cleaning (the "gotchas")

| # | Gotcha | How it's handled | Where it's surfaced |
|---|---|---|---|
| 1 | Different SKU IDs per platform | `SKU_Master` builds a **model** table keyed by both ASIN and FSN. Every Sales/Spends/Locations/Age row resolves to one model. Unknown IDs fall back to a cleaned-name match, then to an “unmapped” model. | Data health → SKU mapping, plus a mapping table |
| 2 | Flipkart has no city | Amazon gets a full city view. The state view covers both platforms, and Flipkart rows without a state appear as **“State not reported”** (hatched). Nothing is imputed. | Geography callout + both geo cards |
| 3 | Multiple spend types | TACOS = **SP + SB + Display + DSP** ÷ GMV. SP is SKU-level. SB/Display/DSP are campaign-level, allocated to models by GMV share within platform × month only when a product filter is applied, so platform and total TACOS stay exact. | Spend card, TACOS tile note, SKU table |
| 4 | Missing cost rates (3 of 14 SKUs) | Those models are **excluded** from gross margin, never treated as zero cost. The margin tile states its GMV coverage. | Margin tile flag, “No cost” badge, Data health |
| 5 | Inconsistent names | Trim, collapse spaces, `60 cm → 60cm`, repair mojibake `mÃ‚Â³ → m3`. Display names come from the master. | Data health → Product naming |
| 6 | Date formats | Amazon `DD-MM-YYYY`, Flipkart `MM/DD/YYYY`. The separator decides the rule, impossible dates are swapped, and failures are counted. | Data health + date-format audit table |
| 7 | Returns / cancellations | Net = GMV − Returns, row by row. **The column is 0 on every row**, which is flagged as a feed problem. | Return-rate tile, Data health |
| 8 | Prev-period & YoY | Previous period = previous calendar month for month presets, equal-length window otherwise. YoY = the same dates last year. Comparisons outside the data range are labelled, not zero-filled. | Every KPI tile, compare note under the filters |

**Metric definitions:** ASP = GMV ÷ units · DRR = units ÷ days in period · TACOS = total ad spend ÷ GMV · Gross margin = (Net − cost rate × units) ÷ Net, on costed models.

## 5. Project layout

```
index.html            page shell
assets/config.js      sheet ID, tab names, refresh interval
assets/data.js        load → clean → model (all gotchas live here)
assets/app.js         filters, KPIs, charts, tables, data health
assets/insights.js    insight cards (narrative + live headline numbers)
assets/styles.css     light/dark theme
data/*.csv            snapshot of the source workbook (fallback)
INSIGHTS.md           one-page summary for the Category Manager
```

Run locally with `python3 -m http.server` in the repo root, then open http://localhost:8000.
