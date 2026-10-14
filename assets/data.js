/*
 * Data layer: load → clean → model.
 *
 * Every raw sheet goes through the same pipeline whether it comes from the live
 * Google Sheet or the bundled snapshot, so appended rows are cleaned exactly
 * like the original ones. Nothing is silently dropped: every correction or gap
 * is counted and surfaced in the Data Health panel.
 */
(function () {
  'use strict';

  const DAY = 86400000;

  /* ---------- small parsing helpers ---------- */

  const norm = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');

  function numOrNull(v) {
    if (v == null) return null;
    const s = String(v).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (s === '' || s === '-') return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  const num = (v) => numOrNull(v) || 0;

  function ymd(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const t = Date.UTC(y, m - 1, d);
    if (new Date(t).getUTCDate() !== d) return null;
    return t / DAY;
  }
  const fixYear = (y) => (y.length === 2 ? 2000 + +y : +y);

  /**
   * Dates arrive in mixed formats: Amazon rows use DD-MM-YYYY, Flipkart rows
   * MM/DD/YYYY. The separator decides the rule; if the rule yields an invalid
   * date (e.g. month 20) we swap day/month and count it as a correction.
   * Returns an integer day number (days since 1970-01-01, UTC).
   */
  function parseDate(raw, st) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) { st.blank++; return null; }
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { st.iso++; return ymd(+m[1], +m[2], +m[3]); }
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/))) {
      const y = fixYear(m[3]);
      let r = ymd(y, +m[2], +m[1]);
      if (r != null) { st.dmy++; return r; }
      r = ymd(y, +m[1], +m[2]);
      if (r != null) { st.swapped++; return r; }
      st.bad++; return null;
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
      const y = fixYear(m[3]);
      let r = ymd(y, +m[1], +m[2]);
      if (r != null) { st.mdy++; return r; }
      r = ymd(y, +m[2], +m[1]);
      if (r != null) { st.swapped++; return r; }
      st.bad++; return null;
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) { st.serial++; return Math.floor(+s) - 25569; } // Excel serial
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      st.other++;
      return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    st.bad++; return null;
  }

  /**
   * Product names are inconsistent: stray spaces, "60 cm" vs "60cm",
   * mojibake units ("mÃ‚Â³/hr"). This returns the canonical display form.
   */
  function cleanName(s) {
    return String(s == null ? '' : s)
      .replace(/m\s*(?:Ã‚Â³|Â³|Ã³|³)/g, 'm3')
      .normalize('NFKC')
      .replace(/[ \s]+/g, ' ')
      .trim()
      .replace(/(\d)\s+cm\b/gi, '$1cm');
  }
  const nameKey = (s) => cleanName(s).toLowerCase();

  function canonPlatform(p) {
    const k = norm(p);
    if (k.startsWith('amazon') || k === 'amz') return 'Amazon';
    if (k.startsWith('flipkart') || k === 'fk') return 'Flipkart';
    return String(p || 'Unknown').trim() || 'Unknown';
  }

  /** Column lookup that tolerates renamed / re-cased headers. */
  function columnPicker(headers, spec, sheet) {
    const map = {};
    const normed = headers.map(norm);
    for (const [field, aliases] of Object.entries(spec)) {
      const idx = normed.findIndex((h) => aliases.includes(h));
      map[field] = idx >= 0 ? headers[idx] : null;
    }
    return map;
  }

  const SPECS = {
    master: {
      asin: ['asin', 'amazonsku', 'amazonid'],
      fsn: ['fsn', 'flipkartsku', 'flipkartid'],
      name: ['productname', 'product', 'model', 'name'],
      cat: ['category'],
      sub: ['subcategory', 'subcat'],
      mop: ['mop', 'mrp', 'price'],
      cost: ['costrate', 'cost', 'unitcost'],
    },
    sales: {
      date: ['date', 'orderdate'],
      platform: ['platform', 'channel', 'marketplace'],
      sku: ['skuid', 'sku', 'asin', 'fsn', 'skuidasinfsn'],
      name: ['productname', 'product'],
      cat: ['category'],
      sub: ['subcategory', 'subcat'],
      units: ['units', 'qty', 'quantity'],
      gmv: ['gmv', 'grossmerchandisevalue', 'sales'],
      net: ['netrevenue', 'net'],
      ret: ['returnscancellations', 'returns', 'cancellations'],
    },
    locations: {
      date: ['date'],
      platform: ['platform'],
      sku: ['skuid', 'sku'],
      city: ['city'],
      state: ['state'],
      units: ['units'],
    },
    age: {
      date: ['date', 'month'],
      platform: ['platform'],
      sku: ['skuid', 'sku'],
      band: ['ageband', 'age'],
      units: ['units', 'unitsshare', 'share'],
    },
    spends: {
      date: ['date'],
      platform: ['platform'],
      type: ['campaigntype', 'type', 'adtype'],
      target: ['skuidcampaign', 'skuid', 'campaign', 'skuorcampaign'],
      spend: ['spend', 'cost', 'adspend'],
      clicks: ['clicks'],
      impr: ['impressions', 'impr'],
    },
  };

  const REQUIRED = {
    master: ['asin', 'fsn', 'name'],
    sales: ['date', 'platform', 'sku', 'units', 'gmv'],
    locations: ['date', 'platform', 'sku', 'units'],
    age: ['date', 'platform', 'sku', 'band', 'units'],
    spends: ['date', 'platform', 'type', 'target', 'spend'],
  };

  /* ---------- loading ---------- */

  function parseCsv(text) {
    const res = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
    return { rows: res.data, headers: res.meta.fields || [] };
  }

  function validateSheet(key, parsed) {
    const cols = columnPicker(parsed.headers, SPECS[key]);
    const missing = REQUIRED[key].filter((f) => !cols[f]);
    if (missing.length) {
      throw new Error(`Tab "${key}" is missing column(s): ${missing.join(', ')} (got: ${parsed.headers.join(', ') || 'nothing'})`);
    }
    return cols;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Sheet returned an HTML page (is it shared publicly?)');
    return text;
  }

  function liveUrl(sheetId, tab) {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
  }

  async function loadFrom(kind, cfg, sheetId) {
    const out = {};
    await Promise.all(Object.entries(cfg.tabs).map(async ([key, tab]) => {
      const url = kind === 'live' ? liveUrl(sheetId, tab) : `${cfg.snapshotPath}${tab}.csv?v=${Date.now()}`;
      const parsed = parseCsv(await fetchText(url));
      parsed.cols = validateSheet(key, parsed);
      out[key] = parsed;
    }));
    return out;
  }

  /**
   * Load all five tabs. In 'auto' mode, try the live sheet first and fall back
   * to the bundled snapshot as a whole (never a mix of the two).
   */
  async function loadRaw(cfg) {
    const params = new URLSearchParams(location.search);
    const sheetId = params.get('sheet') || cfg.sheetId;
    const mode = params.get('source') || cfg.source || 'auto';
    let liveError = null;
    if (mode !== 'snapshot' && sheetId) {
      try {
        return { raw: await loadFrom('live', cfg, sheetId), source: 'live', sheetId };
      } catch (e) {
        liveError = e;
        if (mode === 'live') throw e;
      }
    }
    const raw = await loadFrom('snapshot', cfg, sheetId);
    return { raw, source: 'snapshot', sheetId, liveError };
  }

  /* ---------- modelling ---------- */

  function build(raw) {
    const H = {}; // health counters
    const dateStats = {};
    const ds = (sheet, platform) => {
      const k = sheet + '|' + platform;
      return (dateStats[k] = dateStats[k] || { sheet, platform, dmy: 0, mdy: 0, iso: 0, serial: 0, other: 0, swapped: 0, bad: 0, blank: 0 });
    };

    /* SKU master → one row per physical model, keyed by both ASIN and FSN */
    const models = [];
    const skuToModel = new Map();
    const nameToModel = new Map();
    const mc = raw.master.cols;
    H.masterNameFixes = 0;
    for (const r of raw.master.rows) {
      const asin = String(r[mc.asin] || '').trim().toUpperCase();
      const fsn = String(r[mc.fsn] || '').trim().toUpperCase();
      if (!asin && !fsn) continue;
      const rawName = r[mc.name];
      const name = cleanName(rawName) || asin || fsn;
      if (name !== String(rawName || '')) H.masterNameFixes++;
      const cost = mc.cost ? numOrNull(r[mc.cost]) : null;
      const m = {
        id: models.length,
        name,
        cat: String((mc.cat && r[mc.cat]) || 'Uncategorised').trim(),
        sub: String((mc.sub && r[mc.sub]) || 'Uncategorised').trim(),
        asin, fsn,
        mop: mc.mop ? numOrNull(r[mc.mop]) : null,
        cost: cost && cost > 0 ? cost : null,
        unmapped: false,
      };
      models.push(m);
      if (asin) skuToModel.set(asin, m.id);
      if (fsn) skuToModel.set(fsn, m.id);
      nameToModel.set(nameKey(name), m.id);
    }

    const unmappedByKey = new Map();
    H.unmappedSkus = new Set();
    H.mappedByName = new Set();
    function resolveModel(sku, rawName, cat, sub) {
      const id = skuToModel.get(sku);
      if (id != null) return id;
      if (rawName) {
        const byName = nameToModel.get(nameKey(rawName));
        if (byName != null) { H.mappedByName.add(sku); return byName; }
      }
      H.unmappedSkus.add(sku || '(blank)');
      const key = sku || nameKey(rawName) || '(blank)';
      if (!unmappedByKey.has(key)) {
        const m = {
          id: models.length,
          name: cleanName(rawName) || `Unmapped SKU ${sku}`,
          cat: cat || 'Uncategorised', sub: sub || 'Uncategorised',
          asin: sku.startsWith('B0') ? sku : '', fsn: sku.startsWith('B0') ? '' : sku,
          mop: null, cost: null, unmapped: true,
        };
        models.push(m);
        unmappedByKey.set(key, m.id);
      }
      return unmappedByKey.get(key);
    }

    /* Sales */
    const sc = raw.sales.cols;
    const sales = [];
    const rawNames = new Set();
    H.nameFixedRows = 0;
    H.catMismatch = 0;
    H.salesBadDate = 0;
    H.netMismatch = 0;
    H.zeroUnitRows = 0;
    H.salesRows = raw.sales.rows.length;
    H.returnsNonZero = 0;
    H.hasReturnsCol = !!sc.ret;
    H.hasNetCol = !!sc.net;
    for (const r of raw.sales.rows) {
      const p = canonPlatform(r[sc.platform]);
      const d = parseDate(r[sc.date], ds('Sales', p));
      if (d == null) { H.salesBadDate++; continue; }
      const sku = String(r[sc.sku] || '').trim().toUpperCase();
      const rawName = sc.name ? r[sc.name] : '';
      const rowCat = sc.cat ? String(r[sc.cat] || '').trim() : '';
      const rowSub = sc.sub ? String(r[sc.sub] || '').trim() : '';
      const m = resolveModel(sku, rawName, rowCat, rowSub);
      if (rawName != null && rawName !== '') {
        rawNames.add(rawName);
        if (rawName !== models[m].name) H.nameFixedRows++;
      }
      if (rowCat && rowCat !== models[m].cat) H.catMismatch++;
      const u = num(r[sc.units]);
      const gmv = num(r[sc.gmv]);
      const ret = sc.ret ? num(r[sc.ret]) : 0;
      const net = gmv - ret; // Net = GMV − Returns/Cancellations
      if (ret !== 0) H.returnsNonZero++;
      if (sc.net) {
        const netCol = numOrNull(r[sc.net]);
        if (netCol != null && Math.abs(netCol - net) > 1) H.netMismatch++;
      }
      if (u === 0) H.zeroUnitRows++;
      const cost = models[m].cost;
      sales.push({ d, p, m, u, gmv, ret, net, cogs: cost != null ? cost * u : 0, costed: cost != null });
    }
    H.rawNameVariants = rawNames.size;

    /* GMV by platform × month × model (spend allocation weights) */
    const monthOf = (d) => { const t = new Date(d * DAY); return t.getUTCFullYear() * 12 + t.getUTCMonth(); };
    const weights = new Map(); // key p|month -> Map(model -> gmv), plus total
    for (const s of sales) {
      const k = s.p + '|' + monthOf(s.d);
      let w = weights.get(k);
      if (!w) weights.set(k, (w = { total: 0, by: new Map() }));
      w.total += s.gmv;
      w.by.set(s.m, (w.by.get(s.m) || 0) + s.gmv);
    }

    /* Spends — Sponsored Products are SKU-level; Brands / Display / DSP are
       campaign-level. All types are kept (TACOS needs total spend). Campaign
       spend is allocated to models pro-rata to GMV within platform × month so
       that product filters still yield a meaningful TACOS. With no product
       filter, totals equal the raw sheet exactly. */
    const pc = raw.spends.cols;
    const spends = [];
    H.spendRows = raw.spends.rows.length;
    H.spendBadDate = 0;
    H.spendDirect = 0;
    H.spendAllocated = 0;
    H.spendUnallocated = 0;
    H.spendTypesByPlatform = {};
    for (const r of raw.spends.rows) {
      const p = canonPlatform(r[pc.platform]);
      const d = parseDate(r[pc.date], ds('Spends', p));
      if (d == null) { H.spendBadDate++; continue; }
      const type = String(r[pc.type] || 'Other').trim() || 'Other';
      (H.spendTypesByPlatform[p] = H.spendTypesByPlatform[p] || new Set()).add(type);
      const target = String(r[pc.target] || '').trim();
      const spend = num(r[pc.spend]);
      const clicks = pc.clicks ? num(r[pc.clicks]) : 0;
      const impr = pc.impr ? num(r[pc.impr]) : 0;
      const m = skuToModel.get(target.toUpperCase());
      if (m != null) {
        spends.push({ d, p, m, type, spend, clicks, impr, alloc: false });
        H.spendDirect += spend;
        continue;
      }
      const w = weights.get(p + '|' + monthOf(d));
      if (!w || w.total <= 0) {
        spends.push({ d, p, m: -1, type, spend, clicks, impr, alloc: true });
        H.spendUnallocated += spend;
        continue;
      }
      for (const [mid, g] of w.by) {
        if (g <= 0) continue;
        const f = g / w.total;
        spends.push({ d, p, m: mid, type, spend: spend * f, clicks: clicks * f, impr: impr * f, alloc: true });
      }
      H.spendAllocated += spend;
    }

    /* Locations */
    const lc = raw.locations.cols;
    const locations = [];
    const seen = new Set();
    H.locRows = raw.locations.rows.length;
    H.locDupRows = 0;
    H.locBadDate = 0;
    H.locNoCity = {};
    H.locNoState = {};
    H.locUnits = {};
    for (const r of raw.locations.rows) {
      const sig = JSON.stringify(r);
      if (seen.has(sig)) H.locDupRows++; else seen.add(sig);
      const p = canonPlatform(r[lc.platform]);
      const d = parseDate(r[lc.date], ds('Locations', p));
      if (d == null) { H.locBadDate++; continue; }
      const sku = String(r[lc.sku] || '').trim().toUpperCase();
      const m = skuToModel.has(sku) ? skuToModel.get(sku) : resolveModel(sku, '', '', '');
      const city = lc.city ? String(r[lc.city] || '').trim() : '';
      const state = lc.state ? String(r[lc.state] || '').trim() : '';
      const u = num(r[lc.units]);
      H.locUnits[p] = (H.locUnits[p] || 0) + u;
      if (!city) H.locNoCity[p] = (H.locNoCity[p] || 0) + u;
      if (!state) H.locNoState[p] = (H.locNoState[p] || 0) + u;
      locations.push({ d, p, m, city: city || null, state: state || null, u });
    }

    /* Age (monthly) */
    const ac = raw.age.cols;
    const age = [];
    H.ageBadDate = 0;
    for (const r of raw.age.rows) {
      const p = canonPlatform(r[ac.platform]);
      const d = parseDate(r[ac.date], ds('Age', p));
      if (d == null) { H.ageBadDate++; continue; }
      const sku = String(r[ac.sku] || '').trim().toUpperCase();
      const m = skuToModel.has(sku) ? skuToModel.get(sku) : resolveModel(sku, '', '', '');
      age.push({ d, p, m, band: String(r[ac.band] || 'Unknown').trim(), u: num(r[ac.units]) });
    }

    /* Bounds & dimension lists */
    let dataMin = Infinity, dataMax = -Infinity;
    for (const s of sales) { if (s.d < dataMin) dataMin = s.d; if (s.d > dataMax) dataMax = s.d; }
    const platforms = [...new Set(sales.map((s) => s.p).concat(spends.map((s) => s.p)))]
      .sort((a, b) => rankPlatform(a) - rankPlatform(b) || a.localeCompare(b));
    const spendTypeOrder = ['Sponsored Products', 'Sponsored Brands', 'Display', 'DSP'];
    const spendTypes = [...new Set(spends.map((s) => s.type))]
      .sort((a, b) => ((spendTypeOrder.indexOf(a) + 1) || 99) - ((spendTypeOrder.indexOf(b) + 1) || 99));
    const geoDays = new Set(locations.map((l) => l.d)).size;
    const salesDays = new Set(sales.map((s) => s.d)).size;

    return {
      models, sales, spends, locations, age, platforms, spendTypes,
      dataMin, dataMax, geoDays, salesDays,
      health: H, dateStats: Object.values(dateStats),
      fingerprint: [sales.length, spends.length, locations.length, age.length, models.length, dataMax,
        Math.round(sales.reduce((a, s) => a + s.gmv, 0)), Math.round(spends.reduce((a, s) => a + s.spend, 0))].join('|'),
    };
  }

  function rankPlatform(p) { return p === 'Amazon' ? 0 : p === 'Flipkart' ? 1 : 2; }

  window.BAData = { loadRaw, build, cleanName, parseDate, DAY };
})();
