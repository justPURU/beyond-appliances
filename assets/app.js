/* Dashboard UI: filters → aggregates → tiles, charts, tables. */
(function () {
  'use strict';

  const CFG = window.DASHBOARD_CONFIG;
  const { DAY } = window.BAData;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let M = null;            // built data model
  const META = { source: null, syncedAt: null, liveError: null, sheetId: null, loading: false };
  const S = {
    preset: 'lastMonth', from: null, to: null,
    platform: 'All', cats: new Set(), subs: new Set(), models: new Set(),
    metric: 'gmv', gran: 'daily', granTouched: false,
    sort: { key: 'gmv', dir: -1 }, search: '',
  };
  const charts = {};
  const tables = {};

  /* ---------- formatting ---------- */
  const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  function fmtINR(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} L`;
    return `${s}₹${inr0.format(a)}`;
  }
  const fmtINRFull = (v) => (v == null || !Number.isFinite(v) ? '—' : '₹' + inr0.format(Math.round(v)));
  const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '—' : inr0.format(Math.round(v)));
  const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(d) + '%');
  const fmt1 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
  const signed = (v, d = 1, unit = '%') => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d) + unit;

  /* ---------- dates (integer day numbers, UTC) ---------- */
  const D = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
  function parts(d) { const t = new Date(d * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, day: t.getUTCDate() }; }
  const toISO = (d) => new Date(d * DAY).toISOString().slice(0, 10);
  const fromISO = (s) => { const t = Date.parse(s + 'T00:00:00Z'); return Number.isNaN(t) ? null : t / DAY; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d, withYear = true) { const p = parts(d); return `${String(p.day).padStart(2, '0')} ${MON[p.m - 1]}${withYear ? ' ' + p.y : ''}`; }
  function fmtRange(a, b) {
    const pa = parts(a), pb = parts(b);
    if (a === b) return fmtDate(a);
    if (pa.y === pb.y) return `${fmtDate(a, false)} – ${fmtDate(b)}`;
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }
  function shiftYear(d, k = -1) {
    const p = parts(d);
    const dim = new Date(Date.UTC(p.y + k, p.m, 0)).getUTCDate();
    return D(p.y + k, p.m, Math.min(p.day, dim));
  }
  const dow = (d) => (d + 4) % 7; // 0 = Sunday

  function presetRange(p) {
    const max = M.dataMax, min = M.dataMin;
    const { y, m } = parts(max);
    let r;
    switch (p) {
      case 'last7': r = [max - 6, max]; break;
      case 'last30': r = [max - 29, max]; break;
      case 'last90': r = [max - 89, max]; break;
      case 'mtd': r = [D(y, m, 1), max]; break;
      case 'qtd': r = [D(y, Math.floor((m - 1) / 3) * 3 + 1, 1), max]; break;
      case 'fytd': r = [D(m >= 4 ? y : y - 1, 4, 1), max]; break;
      case 'ytd': r = [D(y, 1, 1), max]; break;
      case 'all': r = [min, max]; break;
      case 'lastMonth':
      default: {
        const eom = D(y, m + 1, 0);
        r = eom === max ? [D(y, m, 1), max] : [D(y, m - 1, 1), D(y, m, 0)];
      }
    }
    return [Math.max(r[0], min), Math.min(r[1], max)];
  }

  function coverage(a, b) {
    if (b < M.dataMin || a > M.dataMax) return 'none';
    if (a < M.dataMin || b > M.dataMax) return 'partial';
    return 'full';
  }
  const coveredDays = (a, b) => Math.max(0, Math.min(b, M.dataMax) - Math.max(a, M.dataMin) + 1);

  /* ---------- filtering & aggregation ---------- */
  const platOk = (p) => S.platform === 'All' || p === S.platform;

  /** Models allowed by category / sub-category / model filters (null = all). */
  function allowedModels({ ignoreModel = false } = {}) {
    const useModel = !ignoreModel && S.models.size;
    if (!S.cats.size && !S.subs.size && !useModel) return null;
    const set = new Set();
    for (const m of M.models) {
      if (S.cats.size && !S.cats.has(m.cat)) continue;
      if (S.subs.size && !S.subs.has(m.sub)) continue;
      if (useModel && !S.models.has(m.id)) continue;
      set.add(m.id);
    }
    return set;
  }

  const zero = () => ({ gmv: 0, u: 0, net: 0, ret: 0, cogs: 0, covNet: 0, covGmv: 0, spend: 0, spendDirect: 0, clicks: 0, impr: 0 });
  function addInto(t, s) { for (const k in t) t[k] += s[k]; return t; }

  /** Per-day totals for the current platform/product filters (date applied later). */
  function buildDaily(allowed, platform = null) {
    const map = new Map();
    const pOk = platform ? (p) => p === platform : platOk;
    const get = (d) => { let o = map.get(d); if (!o) map.set(d, (o = zero())); return o; };
    for (const s of M.sales) {
      if (!pOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      const o = get(s.d);
      o.gmv += s.gmv; o.u += s.u; o.net += s.net; o.ret += s.ret;
      if (s.costed) { o.cogs += s.cogs; o.covNet += s.net; o.covGmv += s.gmv; }
    }
    for (const s of M.spends) {
      if (!pOk(s.p) || (allowed ? !allowed.has(s.m) : false)) continue;
      const o = get(s.d);
      o.spend += s.spend; o.clicks += s.clicks; o.impr += s.impr;
      if (!s.alloc) o.spendDirect += s.spend;
    }
    return map;
  }
  function sumRange(map, a, b) {
    const t = zero();
    for (let d = a; d <= b; d++) { const o = map.get(d); if (o) addInto(t, o); }
    return t;
  }

  const KPI = {
    gmv: { label: 'GMV', val: (t) => t.gmv, fmt: fmtINR, full: fmtINRFull, mode: 'pct' },
    units: { label: 'Units', val: (t) => t.u, fmt: fmtInt, full: fmtInt, mode: 'pct' },
    asp: { label: 'ASP', hint: 'GMV ÷ units', val: (t) => (t.u ? t.gmv / t.u : null), fmt: fmtINRFull, full: fmtINRFull, mode: 'pct' },
    tacos: { label: 'TACOS', hint: 'all ad spend ÷ GMV', val: (t) => (t.gmv ? t.spend / t.gmv : null), fmt: (v) => fmtPct(v, 1), full: (v) => fmtPct(v, 2), mode: 'pp', inverse: true },
    drr: { label: 'DRR', hint: 'units / day', val: (t, days) => (days ? t.u / days : null), fmt: fmt1, full: (v) => fmt1(v) + '/day', mode: 'pct' },
    net: { label: 'Net revenue', hint: 'GMV − returns', val: (t) => t.net, fmt: fmtINR, full: fmtINRFull, mode: 'pct' },
    spend: { label: 'Ad spend', hint: 'SP + SB + Display + DSP', val: (t) => t.spend, fmt: fmtINR, full: fmtINRFull, mode: 'pct', neutral: true },
    margin: { label: 'Gross margin', hint: 'costed models', val: (t) => (t.covNet ? (t.covNet - t.cogs) / t.covNet : null), fmt: (v) => fmtPct(v, 1), full: (v) => fmtPct(v, 2), mode: 'pp' },
    returns: { label: 'Return rate', hint: 'returns ÷ GMV', val: (t) => (t.gmv ? t.ret / t.gmv : null), fmt: (v) => fmtPct(v, 1), full: (v) => fmtPct(v, 2), mode: 'pp', inverse: true },
  };

  /* ---------- color tokens ---------- */
  function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function platformColor(p) { return p === 'Amazon' ? tok('--amazon') : p === 'Flipkart' ? tok('--flipkart') : tok('--t3'); }
  function typeColor(type) {
    const i = M.spendTypes.indexOf(type);
    return tok(['--t1', '--t2', '--t3', '--t4'][i] || '--neutral-fill');
  }

  /* ---------- delta chips ---------- */
  const ARROW_UP = '<svg viewBox="0 0 10 10"><path d="M5 1l4 6H1z"/></svg>';
  const ARROW_DN = '<svg viewBox="0 0 10 10"><path d="M5 9L1 3h8z"/></svg>';
  function deltaChip(def, cur, prev, cov) {
    if (cov === 'none') return '<span class="chip na">no data</span>';
    if (cur == null || prev == null) return '<span class="chip na">n/a</span>';
    let v, txt;
    if (def.mode === 'pp') { v = (cur - prev) * 100; txt = signed(v, 1, ' pp'); }
    else { if (!prev) return '<span class="chip na">n/a</span>'; v = (cur - prev) / Math.abs(prev) * 100; txt = signed(v, 1, '%'); }
    const flat = Math.abs(v) < 0.05;
    let cls = flat ? 'flat' : (v > 0) !== !!def.inverse ? 'up' : 'down';
    if (def.neutral && !flat) cls = 'flat';
    const arrow = flat ? '' : v > 0 ? ARROW_UP : ARROW_DN;
    const warn = cov === 'partial' ? ' <span title="Comparison window is only partly covered by the data">⚠</span>' : '';
    return `<span class="chip ${cls}">${arrow}${txt}</span>${warn}`;
  }

  /* ---------- rendering: KPIs ---------- */
  function windows() {
    const a = S.from, b = S.to, len = b - a + 1;
    let pp = [a - len, a - 1];
    // month-based presets compare with the previous calendar month (same day span for MTD)
    if (S.preset === 'lastMonth' || S.preset === 'mtd') {
      const pa = parts(a), pb = parts(b);
      const start = D(pa.y, pa.m - 1, 1), eom = D(pa.y, pa.m, 0);
      pp = [start, S.preset === 'lastMonth' ? eom : Math.min(eom, start + (pb.day - 1))];
    }
    return { cur: [a, b], pp, ly: [shiftYear(a), shiftYear(b)] };
  }

  function renderKpis(daily, W) {
    const t = { cur: sumRange(daily, ...W.cur), pp: sumRange(daily, ...W.pp), ly: sumRange(daily, ...W.ly) };
    const days = { cur: coveredDays(...W.cur), pp: coveredDays(...W.pp), ly: coveredDays(...W.ly) };
    const cov = { pp: coverage(...W.pp), ly: coverage(...W.ly) };
    const allowed = allowedModels();
    const productFilter = !!allowed;

    const tile = (key, secondary, flag) => {
      const def = KPI[key];
      const v = def.val(t.cur, days.cur), vp = def.val(t.pp, days.pp), vl = def.val(t.ly, days.ly);
      return `<div class="kpi ${secondary ? 'kpi--secondary' : ''}">
        <div class="kpi-label">${def.label}${def.hint ? `<span class="hint">· ${def.hint}</span>` : ''}</div>
        <div class="kpi-value" title="${esc(def.full(v))}">${def.fmt(v)}</div>
        <div class="kpi-deltas">
          <div class="delta">${deltaChip(def, v, vp, cov.pp)}<span class="l-long">vs prev period</span><span class="l-short">vs PP</span><span class="was">${cov.pp === 'none' ? '' : def.fmt(vp)}</span></div>
          <div class="delta">${deltaChip(def, v, vl, cov.ly)}<span class="l-long">vs last year</span><span class="l-short">vs LY</span><span class="was">${cov.ly === 'none' ? '' : def.fmt(vl)}</span></div>
        </div>${flag || ''}</div>`;
    };

    const tacosFlag = productFilter
      ? '<div class="kpi-flag info">Includes GMV-weighted share of Brands / Display / DSP spend (campaign-level)</div>' : '';
    $('#kpis').innerHTML = tile('gmv') + tile('units') + tile('asp') + tile('tacos', false, tacosFlag) + tile('drr');

    // margin coverage flag — the missing cost-rate gap, made explicit
    const covShare = t.cur.gmv ? t.cur.covGmv / t.cur.gmv : 1;
    const missing = M.models.filter((m) => m.cost == null && (!allowed || allowed.has(m.id)));
    const missingActive = missing.filter((m) => M.sales.some((s) => s.m === m.id && s.d >= S.from && s.d <= S.to && platOk(s.p) && s.gmv > 0));
    const marginFlag = missingActive.length
      ? `<div class="kpi-flag">Based on ${fmtPct(covShare, 0)} of GMV. ${missingActive.length} model${missingActive.length > 1 ? 's' : ''} without cost rate excluded</div>` : '';
    const retFlag = M.health.returnsNonZero === 0 ? '<div class="kpi-flag">Returns column is 0 on every row. Net = GMV until the feed is fixed</div>' : '';
    $('#kpis2').innerHTML = tile('net', true) + tile('spend', true) + tile('margin', true, marginFlag) + tile('returns', true, retFlag);

    // compare note
    const covTxt = (c) => (c === 'none' ? ' <span class="muted">(no data)</span>' : c === 'partial' ? ' <span class="muted">(partial)</span>' : '');
    $('#compare-note').innerHTML = `Showing <b>${fmtRange(...W.cur)}</b> (${days.cur} days) · Prev period <b>${fmtRange(...W.pp)}</b>${covTxt(cov.pp)} · Last year <b>${fmtRange(...W.ly)}</b>${covTxt(cov.ly)} · Data available ${fmtRange(M.dataMin, M.dataMax)}`;
    return t;
  }

  /* ---------- buckets ---------- */
  function buckets(a, b, gran) {
    const out = [];
    if (gran === 'daily') {
      for (let d = a; d <= b; d++) out.push({ a: d, b: d, label: fmtDate(d, false), ly: [d - 364, d - 364] });
    } else if (gran === 'weekly') {
      let w = a - ((dow(a) + 6) % 7);
      for (; w <= b; w += 7) {
        const s = Math.max(w, a), e = Math.min(w + 6, b);
        out.push({ a: s, b: e, label: 'Wk ' + fmtDate(w, false), ly: [s - 364, e - 364] });
      }
    } else {
      let { y, m } = parts(a);
      while (D(y, m, 1) <= b) {
        const s = Math.max(D(y, m, 1), a), e = Math.min(D(y, m + 1, 0), b);
        out.push({ a: s, b: e, label: `${MON[m - 1]} ${String(y).slice(2)}`, ly: [shiftYear(s), shiftYear(e)] });
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    return out;
  }

  /* ---------- charts ---------- */
  function chart(id) {
    if (!window.echarts) throw new Error('Chart library (ECharts) did not load. Check assets/vendor/ or the network.');
    const el = document.getElementById(id);
    if (!charts[id]) charts[id] = echarts.init(el, null, { renderer: 'svg' });
    return charts[id];
  }
  function baseOpt() {
    const ink2 = tok('--ink-2'), ink3 = tok('--ink-3'), hair = tok('--hair');
    return {
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: ink2 },
      animationDuration: 350, animationDurationUpdate: 250,
      grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis', backgroundColor: tok('--surface'), borderColor: tok('--hair-2'),
        textStyle: { color: tok('--ink'), fontSize: 12 }, extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.14);border-radius:10px;',
        axisPointer: { type: 'line', lineStyle: { color: tok('--hair-2') } },
      },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink2, fontSize: 12 } },
      xAxis: { type: 'category', axisLine: { lineStyle: { color: tok('--hair-2') } }, axisTick: { show: false }, axisLabel: { color: ink3, fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: hair } }, axisLabel: { color: ink3, fontSize: 11 } },
    };
  }
  const axisFmt = (metric) => (v) => (metric === 'units' ? fmtInt(v) : metric === 'tacos' ? (v * 100).toFixed(0) + '%' : fmtINR(v).replace('.00 Cr', ' Cr'));

  const TREND_METRICS = {
    gmv: { label: 'GMV', v: (t) => t.gmv, f: fmtINRFull },
    units: { label: 'Units', v: (t) => t.u, f: fmtInt },
    net: { label: 'Net', v: (t) => t.net, f: fmtINRFull },
    spend: { label: 'Ad spend', v: (t) => t.spend, f: fmtINRFull },
    tacos: { label: 'TACOS', v: (t) => (t.gmv ? t.spend / t.gmv : null), f: (v) => fmtPct(v, 1) },
  };

  function renderTrend(daily) {
    const met = TREND_METRICS[S.metric];
    const bs = buckets(S.from, S.to, S.gran);
    const ty = bs.map((b) => met.v(sumRange(daily, b.a, b.b)));
    const ly = bs.map((b) => (coverage(b.ly[0], b.ly[1]) === 'full' ? met.v(sumRange(daily, b.ly[0], b.ly[1])) : null));
    const lyCount = ly.filter((v) => v != null).length;
    $('#trend-title').textContent = `${met.label} trend: this year vs last year`;
    $('#trend-sub').textContent = `${fmtRange(S.from, S.to)} · ${S.gran} · LY aligned ${S.gran === 'monthly' ? 'by calendar month' : 'by weekday (−52 weeks)'}` +
      (lyCount < bs.length ? ` · LY shown only where data exists (from ${fmtDate(M.dataMin)})` : '');
    const tyC = tok('--ty'), lyC = tok('--ly');
    const opt = baseOpt();
    opt.xAxis.data = bs.map((b) => b.label);
    opt.yAxis.axisLabel.formatter = axisFmt(S.metric);
    opt.tooltip.formatter = (ps) => {
      const i = ps[0].dataIndex, b = bs[i];
      const yoy = ty[i] != null && ly[i] ? (S.metric === 'tacos' ? signed((ty[i] - ly[i]) * 100, 1, ' pp') : signed((ty[i] / ly[i] - 1) * 100)) : 'n/a';
      return `<div style="font-weight:600;margin-bottom:4px">${fmtRange(b.a, b.b)}</div>
        <div><span style="color:${tyC}">●</span> This year&nbsp; <b>${met.f(ty[i])}</b></div>
        <div><span style="color:${lyC}">●</span> Last year (${fmtRange(b.ly[0], b.ly[1])})&nbsp; <b>${ly[i] == null ? 'no data' : met.f(ly[i])}</b></div>
        <div style="margin-top:4px;color:${tok('--ink-3')}">YoY ${yoy}</div>`;
    };
    const showSym = bs.length <= 40;
    opt.series = [
      { name: 'Last year', type: 'line', data: ly, connectNulls: false, symbol: 'circle', symbolSize: 6, showSymbol: showSym, lineStyle: { width: 2, color: lyC }, itemStyle: { color: lyC } },
      { name: 'This year', type: 'line', data: ty, symbol: 'circle', symbolSize: 7, showSymbol: showSym, lineStyle: { width: 2.25, color: tyC }, itemStyle: { color: tyC, borderColor: tok('--surface'), borderWidth: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: tyC + '33' }, { offset: 1, color: tyC + '00' }]) } },
    ];
    chart('chart-trend').setOption(opt, true);
    tables.trend = {
      cols: ['Period', 'This year', 'Last year', 'YoY'],
      rows: bs.map((b, i) => [fmtRange(b.a, b.b), met.f(ty[i]), ly[i] == null ? '—' : met.f(ly[i]),
        ty[i] != null && ly[i] ? (S.metric === 'tacos' ? signed((ty[i] - ly[i]) * 100, 1, ' pp') : signed((ty[i] / ly[i] - 1) * 100)) : '—']),
    };
  }

  function chartGran() {
    // stacked bar charts get unreadable at 60+ bars: step up a level
    const len = S.to - S.from + 1;
    if (S.gran === 'daily' && len > 62) return 'weekly';
    if (S.gran === 'weekly' && len > 7 * 40) return 'monthly';
    return S.gran;
  }

  function renderPlatform(W) {
    const allowed = allowedModels();
    const plats = M.platforms.filter(platOk);
    const g = chartGran();
    const bs = buckets(S.from, S.to, g);
    const per = {};
    const tot = {}, totLy = {};
    for (const p of plats) {
      const daily = buildDaily(allowed, p);
      per[p] = bs.map((b) => sumRange(daily, b.a, b.b).gmv);
      tot[p] = sumRange(daily, ...W.cur).gmv;
      totLy[p] = coverage(...W.ly) === 'none' ? null : sumRange(daily, ...W.ly).gmv;
    }
    const all = plats.reduce((a, p) => a + tot[p], 0) || 1;
    $('#platform-summary').innerHTML =
      `<div style="width:100%"><div class="sharebar">${plats.map((p) => `<span style="width:${(tot[p] / all) * 100}%;background:${platformColor(p)}"></span>`).join('')}</div></div>` +
      plats.map((p) => {
        const yoy = totLy[p] ? tot[p] / totLy[p] - 1 : null;
        return `<div class="share-item"><div class="lbl"><span class="swatch" style="background:${platformColor(p)}"></span>${esc(p)}</div>
          <div class="val">${fmtPct(tot[p] / all, 1)}</div>
          <div class="sub">${fmtINR(tot[p])} · YoY ${yoy == null ? 'n/a' : `<span class="${yoy >= 0 ? 'pos' : 'neg'}">${signed(yoy * 100)}</span>`}</div></div>`;
      }).join('');
    const opt = baseOpt();
    opt.xAxis.data = bs.map((b) => b.label);
    opt.yAxis.axisLabel.formatter = axisFmt('gmv');
    opt.tooltip.formatter = (ps) => {
      const i = ps[0].dataIndex; const sum = ps.reduce((a, x) => a + (x.value || 0), 0) || 1;
      return `<div style="font-weight:600;margin-bottom:4px">${fmtRange(bs[i].a, bs[i].b)}</div>` +
        ps.map((x) => `<div>${x.marker} ${x.seriesName}&nbsp; <b>${fmtINRFull(x.value)}</b> <span style="color:${tok('--ink-3')}">(${fmtPct(x.value / sum, 0)})</span></div>`).join('');
    };
    opt.series = plats.map((p, i) => ({
      name: p, type: 'bar', stack: 'gmv', data: per[p], barMaxWidth: 28,
      itemStyle: { color: platformColor(p), borderColor: tok('--surface'), borderWidth: 1, borderRadius: i === plats.length - 1 ? [4, 4, 0, 0] : 0 },
    }));
    chart('chart-platform').setOption(opt, true);
    tables.platform = { cols: ['Period', ...plats], rows: bs.map((b, i) => [fmtRange(b.a, b.b), ...plats.map((p) => fmtINRFull(per[p][i]))]) };
  }

  function renderCategories(W) {
    const allowed = allowedModels();
    const agg = new Map();
    const lyCov = coverage(...W.ly) !== 'none';
    for (const s of M.sales) {
      if (!platOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      const inCur = s.d >= W.cur[0] && s.d <= W.cur[1];
      const inLy = s.d >= W.ly[0] && s.d <= W.ly[1];
      if (!inCur && !inLy) continue;
      const m = M.models[s.m];
      const k = m.cat + '|' + m.sub;
      let o = agg.get(k); if (!o) agg.set(k, (o = { cat: m.cat, sub: m.sub, gmv: 0, ly: 0, u: 0 }));
      if (inCur) { o.gmv += s.gmv; o.u += s.u; }
      if (inLy) o.ly += s.gmv;
    }
    const rows = [...agg.values()];
    const total = rows.reduce((a, r) => a + r.gmv, 0) || 1;
    const cats = new Map();
    for (const r of rows) { const c = cats.get(r.cat) || { gmv: 0, ly: 0, subs: [] }; c.gmv += r.gmv; c.ly += r.ly; c.subs.push(r); cats.set(r.cat, c); }
    const max = Math.max(1, ...rows.map((r) => r.gmv));
    const yoyTxt = (g, l) => (!lyCov || !l ? '<span class="muted">YoY n/a</span>' : `<span class="${g >= l ? 'pos' : 'neg'}">${signed((g / l - 1) * 100)}</span>`);
    const accent = tok('--accent');
    $('#category-list').innerHTML = `<div class="barlist">` + [...cats.entries()].sort((a, b) => b[1].gmv - a[1].gmv).map(([cat, c]) =>
      `<div class="bl-group"><span>${esc(cat)}</span><span>${fmtINR(c.gmv)} · ${fmtPct(c.gmv / total, 0)} · ${yoyTxt(c.gmv, c.ly)}</span></div>` +
      c.subs.sort((a, b) => b.gmv - a.gmv).map((r) => `
        <div class="bl-row" data-tip="${esc(`<b>${r.sub}</b><br>GMV ${fmtINRFull(r.gmv)} · ${fmtInt(r.u)} units<br>Share ${fmtPct(r.gmv / total, 1)}<br>LY ${lyCov ? fmtINRFull(r.ly) : 'n/a'}`)}">
          <div class="bl-name">${esc(r.sub)}</div>
          <div class="bl-val"><b>${fmtINR(r.gmv)}</b> · ${fmtPct(r.gmv / total, 1)} · ${yoyTxt(r.gmv, r.ly)}</div>
          <div class="bl-track"><span style="width:${(r.gmv / max) * 100}%;background:${accent}"></span></div>
        </div>`).join('')).join('') + `</div>` +
      (rows.length ? '' : '<p class="muted">No sales in this selection.</p>');
  }

  function renderSpend(daily, W) {
    const allowed = allowedModels();
    const g = chartGran();
    const bs = buckets(S.from, S.to, g);
    const types = M.spendTypes;
    const byType = Object.fromEntries(types.map((t) => [t, { spend: 0, clicks: 0, impr: 0, plats: new Set() }]));
    const series = Object.fromEntries(types.map((t) => [t, bs.map(() => 0)]));
    const idxOf = (d) => { let lo = 0, hi = bs.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (d < bs[mid].a) hi = mid - 1; else if (d > bs[mid].b) lo = mid + 1; else return mid; } return -1; };
    for (const s of M.spends) {
      if (s.d < W.cur[0] || s.d > W.cur[1] || !platOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      const o = byType[s.type]; o.spend += s.spend; o.clicks += s.clicks; o.impr += s.impr; o.plats.add(s.p);
      const i = idxOf(s.d); if (i >= 0) series[s.type][i] += s.spend;
    }
    const tc = sumRange(daily, ...W.cur);
    const totalSpend = tc.spend || 0;
    const platTacos = M.platforms.filter(platOk).map((p) => {
      const dp = buildDaily(allowed, p); const t = sumRange(dp, ...W.cur);
      return `<div class="share-item"><div class="lbl"><span class="swatch" style="background:${platformColor(p)}"></span>${esc(p)} TACOS</div><div class="val">${fmtPct(t.gmv ? t.spend / t.gmv : null)}</div><div class="sub">${fmtINR(t.spend)} on ${fmtINR(t.gmv)}</div></div>`;
    });
    $('#spend-summary').innerHTML = `<div class="share-item"><div class="lbl">Total ad spend</div><div class="val">${fmtINR(totalSpend)}</div><div class="sub">TACOS ${fmtPct(tc.gmv ? totalSpend / tc.gmv : null)}</div></div>` + platTacos.join('');
    const opt = baseOpt();
    opt.xAxis.data = bs.map((b) => b.label);
    opt.yAxis.axisLabel.formatter = axisFmt('spend');
    opt.tooltip.formatter = (ps) => {
      const i = ps[0].dataIndex; const sum = ps.reduce((a, x) => a + (x.value || 0), 0);
      return `<div style="font-weight:600;margin-bottom:4px">${fmtRange(bs[i].a, bs[i].b)} · ${fmtINRFull(sum)}</div>` +
        ps.slice().reverse().map((x) => `<div>${x.marker} ${x.seriesName}&nbsp; <b>${fmtINRFull(x.value)}</b></div>`).join('');
    };
    opt.series = types.map((t, i) => ({
      name: t, type: 'bar', stack: 'spend', data: series[t], barMaxWidth: 28,
      itemStyle: { color: typeColor(t), borderColor: tok('--surface'), borderWidth: 1, borderRadius: i === types.length - 1 ? [4, 4, 0, 0] : 0 },
    }));
    chart('chart-spend').setOption(opt, true);
    tables.spend = { cols: ['Period', ...types, 'Total'], rows: bs.map((b, i) => [fmtRange(b.a, b.b), ...types.map((t) => fmtINRFull(series[t][i])), fmtINRFull(types.reduce((a, t) => a + series[t][i], 0))]) };

    const allPlats = M.platforms.filter(platOk);
    $('#spend-types').innerHTML = `<div class="table-scroll" style="margin-top:10px"><table class="data-table data-table--compact">
      <thead><tr><th class="l">Campaign type</th><th>Spend</th><th>Share</th><th>CTR</th><th>CPC</th></tr></thead><tbody>` +
      types.map((t) => {
        const o = byType[t];
        const missing = allPlats.filter((p) => !(M.health.spendTypesByPlatform[p] || new Set()).has(t));
        return `<tr><td class="l" title="${t === 'Sponsored Products' ? 'Tracked per ASIN/FSN' : 'Tracked per campaign'}"><span class="swatch" style="background:${typeColor(t)}"></span> ${esc(t)}${missing.length ? ` <span class="badge badge--muted" title="No ${esc(t)} rows for ${esc(missing.join(', '))}">not on ${esc(missing.join(', '))}</span>` : ''}</td>
          <td>${fmtINR(o.spend)}</td><td>${fmtPct(totalSpend ? o.spend / totalSpend : null, 0)}</td>
          <td>${fmtPct(o.impr ? o.clicks / o.impr : null, 2)}</td><td>${o.clicks ? '₹' + (o.spend / o.clicks).toFixed(1) : '—'}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- geography ---------- */
  function renderGeo(W) {
    const allowed = allowedModels();
    const st = new Map(), city = new Map();
    let fkNoCity = 0, fkUnits = 0, amzUnits = 0, noState = { Amazon: 0, Flipkart: 0 };
    let geoUnits = 0;
    const geoDaysInRange = new Set();
    for (const l of M.locations) {
      if (l.d < W.cur[0] || l.d > W.cur[1] || !platOk(l.p) || (allowed && !allowed.has(l.m))) continue;
      geoUnits += l.u; geoDaysInRange.add(l.d);
      if (l.p === 'Flipkart') { fkUnits += l.u; if (!l.city) fkNoCity += l.u; } else if (l.p === 'Amazon') amzUnits += l.u;
      const sk = l.state || '__none__';
      let o = st.get(sk); if (!o) st.set(sk, (o = { name: l.state, by: {} }));
      o.by[l.p] = (o.by[l.p] || 0) + l.u;
      if (!l.state) noState[l.p] = (noState[l.p] || 0) + l.u;
      if (l.city) {
        const ck = l.city + '|' + (l.state || '');
        let c = city.get(ck); if (!c) city.set(ck, (c = { city: l.city, state: l.state, u: 0, p: l.p }));
        c.u += l.u;
      }
    }
    let salesUnits = 0; const salesDays = new Set();
    for (const s of M.sales) {
      if (s.d < W.cur[0] || s.d > W.cur[1] || !platOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      salesUnits += s.u; if (s.u) salesDays.add(s.d);
    }
    const plats = M.platforms.filter(platOk);
    $('#state-legend').innerHTML = plats.map((p) => `<span><span class="swatch" style="background:${platformColor(p)}"></span>${esc(p)}</span>`).join('') +
      `<span><span class="swatch" style="background:repeating-linear-gradient(135deg,var(--neutral-fill) 0 2px,transparent 2px 4px)"></span>State not reported</span>`;

    const rows = [...st.values()].map((o) => ({ ...o, total: Object.values(o.by).reduce((a, b) => a + b, 0) }));
    const known = rows.filter((r) => r.name).sort((a, b) => b.total - a.total);
    const gap = rows.find((r) => !r.name);
    const max = Math.max(1, ...rows.map((r) => r.total));
    const tot = geoUnits || 1;
    const stateRow = (r) => `<div class="bl-row ${r.name ? '' : 'is-gap'}" data-tip="${esc(`<b>${r.name || 'State not reported'}</b><br>` + plats.map((p) => `${p}: ${fmtInt(r.by[p] || 0)} units`).join('<br>'))}">
        <div class="bl-name">${esc(r.name || 'State not reported (Flipkart)')}</div>
        <div class="bl-val"><b>${fmtInt(r.total)}</b> · ${fmtPct(r.total / tot, 1)}</div>
        <div class="bl-track">${plats.map((p) => (r.by[p] ? `<span class="${r.name ? '' : 'hatch'}" style="width:${(r.by[p] / max) * 100}%;${r.name ? `background:${platformColor(p)}` : ''}"></span>` : '')).join('')}</div>
      </div>`;
    $('#state-list').innerHTML = `<div class="barlist">${known.map(stateRow).join('')}${gap ? stateRow(gap) : ''}</div>` + (rows.length ? '' : '<p class="muted">No geo rows in this selection.</p>');

    const cities = [...city.values()].sort((a, b) => b.u - a.u);
    const cmax = Math.max(1, ...cities.map((c) => c.u));
    const amzTot = amzUnits || 1;
    let cityHtml = '';
    if (!plats.includes('Amazon')) {
      cityHtml = `<div class="callout callout--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><p><b>City data is not available for Flipkart.</b> Flipkart Iris reports state at best. See the state view.</p></div>`;
    } else {
      cityHtml = `<div class="barlist">` + cities.map((c) => `<div class="bl-row" data-tip="${esc(`<b>${c.city}</b>, ${c.state || ''}<br>${fmtInt(c.u)} Amazon units · ${fmtPct(c.u / amzTot, 1)} of Amazon geo`)}">
          <div class="bl-name">${esc(c.city)} <small>${esc(c.state || '')}</small></div>
          <div class="bl-val"><b>${fmtInt(c.u)}</b> · ${fmtPct(c.u / amzTot, 1)}</div>
          <div class="bl-track"><span style="width:${(c.u / cmax) * 100}%;background:${platformColor('Amazon')}"></span></div></div>`).join('') +
        (plats.includes('Flipkart') && fkUnits ? `<div class="bl-row is-gap" data-tip="${esc('Flipkart Iris has no city field. These units are shown at state level only, never estimated.')}">
          <div class="bl-name">Flipkart: city unavailable</div><div class="bl-val"><b>${fmtInt(fkNoCity)}</b> units not shown</div>
          <div class="bl-track"><span class="hatch" style="width:${Math.min(100, (fkNoCity / cmax) * 100)}%"></span></div></div>` : '') + `</div>`;
    }
    $('#city-list').innerHTML = cityHtml;

    const geoCov = salesUnits ? geoUnits / salesUnits : null;
    $('#geo-note').innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg><p>
      <b>Geo is a sampled feed.</b> It has ${geoDaysInRange.size} of ${salesDays.size} selling days in this period and ${fmtInt(geoUnits)} units (${fmtPct(geoCov, 0)} of sales units), so read it as a <i>distribution</i>, not totals.
      ${plats.includes('Amazon') ? `Amazon: city + state on ${fmtPct(amzUnits ? 1 - (noState.Amazon || 0) / amzUnits : null, 0)} of units.` : ''}
      ${plats.includes('Flipkart') ? `Flipkart: <b>no city on any row</b>, and <b>state missing on ${fmtPct(fkUnits ? (noState.Flipkart || 0) / fkUnits : null, 0)}</b> of units. These are shown as "State not reported", not dropped or re-assigned.` : ''}</p>`;
  }

  function renderAge(W) {
    const allowed = allowedModels();
    const startMonth = (() => { const p = parts(W.cur[0]); return D(p.y, p.m, 1); })();
    const bands = new Map();
    const plats = M.platforms.filter(platOk);
    const totals = {};
    const months = new Set();
    for (const a of M.age) {
      if (a.d < startMonth || a.d > W.cur[1] || !platOk(a.p) || (allowed && !allowed.has(a.m))) continue;
      months.add(a.d);
      const o = bands.get(a.band) || {}; o[a.p] = (o[a.p] || 0) + a.u; bands.set(a.band, o);
      totals[a.p] = (totals[a.p] || 0) + a.u;
    }
    const names = [...bands.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    const opt = baseOpt();
    opt.grid.top = 30;
    opt.xAxis = { type: 'value', max: (v) => Math.min(1, Math.ceil(v.max * 10 + 0.5) / 10), splitLine: { lineStyle: { color: tok('--hair') } }, axisLabel: { color: tok('--ink-3'), fontSize: 11, formatter: (v) => (v * 100).toFixed(0) + '%' } };
    opt.yAxis = { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { lineStyle: { color: tok('--hair-2') } }, axisLabel: { color: tok('--ink-2'), fontSize: 11.5 } };
    opt.tooltip.axisPointer = { type: 'shadow', shadowStyle: { color: tok('--surface-3') + '88' } };
    opt.tooltip.formatter = (ps) => `<div style="font-weight:600;margin-bottom:4px">Age ${ps[0].name}</div>` + ps.map((x) => `<div>${x.marker} ${x.seriesName}&nbsp; <b>${fmtPct(x.value, 1)}</b></div>`).join('');
    opt.series = plats.map((p) => ({
      name: p, type: 'bar', data: names.map((n) => (totals[p] ? (bands.get(n)[p] || 0) / totals[p] : 0)), barMaxWidth: 10, barGap: '30%',
      itemStyle: { color: platformColor(p), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 10.5, color: tok('--ink-3'), formatter: (x) => (x.value >= 0.005 ? (x.value * 100).toFixed(0) + '%' : '') },
    }));
    chart('chart-age').setOption(opt, true);
    tables.age = { cols: ['Age band', ...plats.map((p) => p + ' share'), ...plats.map((p) => p + ' units')], rows: names.map((n) => [n, ...plats.map((p) => fmtPct(totals[p] ? (bands.get(n)[p] || 0) / totals[p] : null, 1)), ...plats.map((p) => fmtInt(bands.get(n)[p] || 0))]) };
    const ms = [...months].sort((a, b) => a - b);
    $('#age-note').textContent = ms.length
      ? `Monthly feed. Includes ${ms.map((d) => { const p = parts(d); return MON[p.m - 1] + ' ' + p.y; }).join(', ')}. Age units do not reconcile to sales units (see Data health), so only shares are shown.`
      : 'No age data for this period.';
  }

  /* ---------- SKU table ---------- */
  function skuRows(W) {
    const allowed = allowedModels({ ignoreModel: true });
    const rows = new Map();
    const lyCov = coverage(...W.ly) !== 'none', ppCov = coverage(...W.pp) !== 'none';
    const get = (id) => { let r = rows.get(id); if (!r) rows.set(id, (r = { id, cur: zero(), pp: zero(), ly: zero(), amz: 0, fk: 0 })); return r; };
    const which = (d) => [d >= W.cur[0] && d <= W.cur[1] ? 'cur' : null, d >= W.pp[0] && d <= W.pp[1] ? 'pp' : null, d >= W.ly[0] && d <= W.ly[1] ? 'ly' : null].filter(Boolean);
    for (const s of M.sales) {
      if (!platOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      const ws = which(s.d); if (!ws.length) continue;
      const r = get(s.m);
      for (const w of ws) { const o = r[w]; o.gmv += s.gmv; o.u += s.u; o.net += s.net; o.ret += s.ret; if (s.costed) { o.cogs += s.cogs; o.covNet += s.net; o.covGmv += s.gmv; } }
      if (ws.includes('cur')) { if (s.p === 'Amazon') r.amz += s.gmv; else if (s.p === 'Flipkart') r.fk += s.gmv; }
    }
    for (const s of M.spends) {
      if (s.m < 0 || !platOk(s.p) || (allowed && !allowed.has(s.m))) continue;
      const ws = which(s.d); if (!ws.length) continue;
      const r = get(s.m);
      for (const w of ws) { r[w].spend += s.spend; if (!s.alloc) r[w].spendDirect += s.spend; }
    }
    const days = coveredDays(...W.cur);
    const total = [...rows.values()].reduce((a, r) => a + r.cur.gmv, 0) || 1;
    return [...rows.values()].filter((r) => r.cur.gmv || r.cur.u || r.cur.spend).map((r) => {
      const m = M.models[r.id];
      const c = r.cur;
      return {
        id: r.id, m, name: m.name, sub: m.sub, cat: m.cat, units: c.u, gmv: c.gmv, net: c.net, share: c.gmv / total,
        asp: c.u ? c.gmv / c.u : null,
        pp: ppCov && r.pp.gmv ? c.gmv / r.pp.gmv - 1 : null,
        yoy: lyCov && r.ly.gmv ? c.gmv / r.ly.gmv - 1 : null,
        amzShare: r.amz + r.fk ? r.amz / (r.amz + r.fk) : null,
        spend: c.spend, spendDirect: c.spendDirect,
        tacos: c.gmv ? c.spend / c.gmv : null,
        margin: m.cost != null && c.net ? (c.net - c.cogs) / c.net : null,
        drr: days ? c.u / days : null,
      };
    });
  }

  const SKU_COLS = [
    { key: 'name', label: 'Model', l: true, cell: (r) => `<div class="model-cell"><b title="${esc(r.name)}">${esc(r.name)}</b><small>${esc(r.m.asin || '—')} · ${esc(r.m.fsn || '—')}${r.m.unmapped ? ' · <span class="badge badge--bad">unmapped</span>' : ''}</small></div>`, sortVal: (r) => r.name },
    { key: 'sub', label: 'Sub-category', l: true, cell: (r) => `<span class="muted">${esc(r.sub)}</span>`, sortVal: (r) => r.sub },
    { key: 'units', label: 'Units', cell: (r) => fmtInt(r.units) },
    { key: 'gmv', label: 'GMV', cell: (r) => fmtINR(r.gmv) },
    { key: 'share', label: 'Share', cell: (r) => fmtPct(r.share, 1) },
    { key: 'asp', label: 'ASP', cell: (r) => fmtINRFull(r.asp) },
    { key: 'pp', label: 'vs PP', cell: (r) => pctCell(r.pp) },
    { key: 'yoy', label: 'vs LY', cell: (r) => pctCell(r.yoy) },
    { key: 'amzShare', label: 'AMZ | FK', cell: (r) => (r.amzShare == null ? '—' : `<span class="split" title="Amazon ${fmtPct(r.amzShare, 0)} · Flipkart ${fmtPct(1 - r.amzShare, 0)}"><span style="width:${r.amzShare * 100}%;background:${platformColor('Amazon')}"></span><span style="width:${(1 - r.amzShare) * 100}%;background:${platformColor('Flipkart')}"></span></span> <span class="muted">${fmtPct(r.amzShare, 0)}</span>`) },
    { key: 'spend', label: 'Ad spend', cell: (r) => `<span title="SKU-level SP: ${fmtINRFull(r.spendDirect)} · allocated campaign spend: ${fmtINRFull(r.spend - r.spendDirect)}">${fmtINR(r.spend)}</span>` },
    { key: 'tacos', label: 'TACOS', cell: (r) => (r.tacos == null ? '—' : `<span class="${r.tacos > 0.15 ? 'neg' : ''}">${fmtPct(r.tacos, 1)}</span>`) },
    { key: 'margin', label: 'Gross margin', cell: (r) => (r.m.cost == null ? '<span class="badge badge--warn" title="Cost rate missing in SKU master; excluded from margin">No cost</span>' : fmtPct(r.margin, 1)) },
    { key: 'drr', label: 'DRR', cell: (r) => fmt1(r.drr) },
  ];
  function pctCell(v) { return v == null ? '<span class="muted">n/a</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${signed(v * 100)}</span>`; }

  let lastSkuRows = [];
  function renderSku(W) {
    let rows = skuRows(W);
    const q = S.search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.name + ' ' + r.m.asin + ' ' + r.m.fsn + ' ' + r.sub).toLowerCase().includes(q));
    const col = SKU_COLS.find((c) => c.key === S.sort.key) || SKU_COLS[3];
    const sv = col.sortVal || ((r) => r[col.key]);
    rows.sort((a, b) => {
      const x = sv(a), y = sv(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * S.sort.dir;
    });
    lastSkuRows = rows;
    const t = rows.reduce((a, r) => { a.units += r.units; a.gmv += r.gmv; a.spend += r.spend; return a; }, { units: 0, gmv: 0, spend: 0 });
    const days = coveredDays(...W.cur);
    $('#sku-table').innerHTML = `<thead><tr>${SKU_COLS.map((c) => `<th class="sortable ${c.l ? 'l' : ''} ${S.sort.key === c.key ? 'sorted' + (S.sort.dir > 0 ? ' asc' : '') : ''}" data-sort="${c.key}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="clickable ${S.models.has(r.id) ? 'is-selected' : ''}" data-model="${r.id}">${SKU_COLS.map((c) => `<td class="${c.l ? 'l' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${SKU_COLS.length}" class="l muted">No models match.</td></tr>`}</tbody>
      <tfoot><tr><td class="l">Total · ${rows.length} models</td><td></td><td>${fmtInt(t.units)}</td><td>${fmtINR(t.gmv)}</td><td></td><td>${fmtINRFull(t.units ? t.gmv / t.units : null)}</td><td></td><td></td><td></td><td>${fmtINR(t.spend)}</td><td>${fmtPct(t.gmv ? t.spend / t.gmv : null, 1)}</td><td></td><td>${fmt1(days ? t.units / days : null)}</td></tr></tfoot>`;
    const sel = S.models.size ? ` · <b>${S.models.size} selected</b> (click again to clear)` : '';
    $('#sku-sub').innerHTML = `One row per physical model (ASIN ↔ FSN unified) · ${fmtRange(...W.cur)}. Click a row to filter the whole dashboard to it${sel}.`;
  }

  function exportSku() {
    const head = ['Model', 'ASIN', 'FSN', 'Category', 'Sub-category', 'Units', 'GMV', 'Net', 'Share', 'ASP', 'GMV vs PP', 'GMV vs LY', 'Amazon share', 'Ad spend', 'SP spend (SKU-level)', 'TACOS', 'Cost rate', 'Gross margin', 'DRR'];
    const n = (v, d = 4) => (v == null ? '' : +v.toFixed(d));
    const lines = [head].concat(lastSkuRows.map((r) => [r.name, r.m.asin, r.m.fsn, r.cat, r.sub, r.units, n(r.gmv, 2), n(r.net, 2), n(r.share), n(r.asp, 2), n(r.pp), n(r.yoy), n(r.amzShare), n(r.spend, 2), n(r.spendDirect, 2), n(r.tacos), r.m.cost ?? 'MISSING', n(r.margin), n(r.drr, 2)]));
    const csv = lines.map((l) => l.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sku-performance_${toISO(S.from)}_${toISO(S.to)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- data health ---------- */
  function renderHealth() {
    const H = M.health;
    const totalGmv = M.sales.reduce((a, s) => a + s.gmv, 0) || 1;
    const master = M.models.filter((m) => !m.unmapped);
    const noCost = master.filter((m) => m.cost == null);
    const noCostGmv = M.sales.filter((s) => !s.costed).reduce((a, s) => a + s.gmv, 0);
    const mapped = M.models.filter((m) => !m.unmapped);
    const ids = new Set(M.sales.map((s) => s.m));
    const fk = (o) => o.Flipkart || 0;
    const totSpend = H.spendDirect + H.spendAllocated + H.spendUnallocated || 1;
    const dsBad = M.dateStats.reduce((a, d) => a + d.bad + d.blank, 0);
    const dsSwap = M.dateStats.reduce((a, d) => a + d.swapped, 0);
    const dsTotal = M.dateStats.reduce((a, d) => a + d.dmy + d.mdy + d.iso + d.serial + d.other + d.swapped, 0);
    const salesUnits = M.sales.reduce((a, s) => a + s.u, 0);
    const ageUnits = M.age.reduce((a, s) => a + s.u, 0);
    const platsNoType = M.platforms.map((p) => [p, M.spendTypes.filter((t) => !(H.spendTypesByPlatform[p] || new Set()).has(t))]).filter(([, t]) => t.length);

    const items = [
      {
        sev: H.unmappedSkus.size ? 'bad' : 'ok', title: 'SKU mapping (ASIN ↔ FSN)', badge: H.unmappedSkus.size ? `${H.unmappedSkus.size} unmapped` : 'Clean',
        metric: `${mapped.length * 2} IDs → ${mapped.length} models`,
        body: [`Each Amazon ASIN and Flipkart FSN is resolved through SKU_Master to one physical model, so every view compares the same product across platforms.`,
          H.unmappedSkus.size ? `<b>Unmapped IDs:</b> ${esc([...H.unmappedSkus].join(', '))}. They are kept as their own rows tagged “unmapped”. Add them to SKU_Master.` : 'Every SKU ID in Sales, Spends, Locations and Age matched the master.',
          H.mappedByName.size ? `${H.mappedByName.size} ID(s) matched by cleaned product name instead of ID: ${esc([...H.mappedByName].join(', '))}.` : ''],
      },
      {
        sev: 'warn', title: 'Missing cost rates', badge: `${noCost.length} of ${master.length} SKUs`,
        metric: `${fmtPct(noCostGmv / totalGmv, 1)} of GMV`,
        body: [`No cost rate for: ${noCost.map((m) => `<b>${esc(m.name)}</b>`).join(', ') || '—'}.`,
          `These models are <b>excluded</b> from gross margin, never counted as 0 cost. The margin tile states the GMV coverage it is based on, and the SKU table marks them “No cost”.`],
      },
      {
        sev: 'warn', title: 'Flipkart geography gap', badge: 'Transparent',
        metric: `${fmtPct(fk(H.locUnits) ? fk(H.locNoCity) / fk(H.locUnits) : null, 0)} no city · ${fmtPct(fk(H.locUnits) ? fk(H.locNoState) / fk(H.locUnits) : null, 0)} no state`,
        body: [`Flipkart Iris has no city field. Amazon city + state coverage is ${fmtPct(H.locUnits.Amazon ? 1 - (H.locNoState.Amazon || 0) / H.locUnits.Amazon : null, 0)}.`,
          `Flipkart is shown at state level only. Units with no state appear as “State not reported”. Nothing is estimated or re-assigned.`],
      },
      {
        sev: H.returnsNonZero ? 'ok' : 'warn', title: 'Returns / cancellations', badge: H.returnsNonZero ? 'Applied' : 'Feed looks empty',
        metric: H.returnsNonZero ? `${fmtInt(H.returnsNonZero)} rows with returns` : `0 of ${fmtInt(H.salesRows)} rows non-zero`,
        body: [`Net revenue = GMV − Returns/Cancellations, applied row by row.`,
          H.returnsNonZero ? '' : `<b>Every row has 0 returns</b>, so Net equals GMV. That is unrealistic for large appliances (returns usually run 3–8%). Confirm the returns export from Amazon PI / Flipkart Iris before quoting net numbers.`,
          H.hasNetCol ? (H.netMismatch ? `${fmtInt(H.netMismatch)} rows where the sheet's Net Revenue ≠ GMV − Returns.` : `Sheet's own Net Revenue column reconciles on every row.`) : ''],
      },
      {
        sev: dsBad ? 'bad' : 'ok', title: 'Date formats', badge: dsBad ? `${dsBad} unparseable` : 'Normalised',
        metric: `${fmtInt(dsTotal)} dates parsed`,
        body: [`Amazon rows use <b>DD-MM-YYYY</b>, Flipkart rows <b>MM/DD/YYYY</b>, in every sheet. The separator decides the rule, so 09/01/2026 on Flipkart reads as 1 Sep and 01-09-2026 on Amazon reads as 1 Sep.`,
          dsSwap ? `${dsSwap} date(s) were impossible under their rule (e.g. month 13) and were day/month-swapped.` : 'No ambiguous or impossible dates found.',
          dsBad ? `${dsBad} rows had blank/unreadable dates and are excluded.` : ''],
      },
      {
        sev: 'ok', title: 'Product naming', badge: 'Cleaned',
        metric: `${H.rawNameVariants} raw names → ${ids.size} models`,
        body: [`${fmtInt(H.nameFixedRows)} sales rows had a non-canonical name (leading/trailing spaces, “60 cm” vs “60cm”, garbled “mÃ‚Â³/hr”). Names come from the SKU master via the ID, so the variants never split a product.`],
      },
      {
        sev: 'info', title: 'Spend consolidation', badge: 'All types in TACOS',
        metric: `${fmtPct(H.spendDirect / totSpend, 0)} SKU-level · ${fmtPct((H.spendAllocated + H.spendUnallocated) / totSpend, 0)} campaign-level`,
        body: [`TACOS uses all spend: ${M.spendTypes.join(' + ')}. Sponsored Products is tracked per ASIN/FSN. Brands, Display and DSP are per campaign.`,
          `When you filter by category or model, campaign spend is allocated by each model's GMV share for that platform and month. Platform-level and total TACOS are exact.`,
          platsNoType.length ? platsNoType.map(([p, t]) => `${esc(p)} has no ${esc(t.join(', '))} spend.`).join(' ') : ''],
      },
      {
        sev: 'info', title: 'Geo & age feeds are partial', badge: 'Shares only',
        metric: `Geo on ${M.geoDays} of ${M.salesDays} days`,
        body: [`Locations rows cover ${fmtPct(Object.values(H.locUnits).reduce((a, b) => a + b, 0) / (salesUnits || 1), 0)} of sales units, and ${fmtInt(H.locDupRows)} rows are exact duplicates. They are kept, since Flipkart splits one state's units across rows.`,
          `Age units total ${fmtInt(ageUnits)} against ${fmtInt(salesUnits)} sales units, so the feed is a panel. Both are shown as distributions, not totals.`],
      },
      {
        sev: 'info', title: 'Zero-sale rows', badge: 'Kept',
        metric: `${fmtInt(H.zeroUnitRows)} rows`,
        body: [`Rows with 0 units / 0 GMV (days a SKU didn't sell) are kept. They don't change totals but DRR counts calendar days, not selling days.`],
      },
    ];
    const flags = items.filter((i) => i.sev === 'warn' || i.sev === 'bad').length;
    const badge = $('#health-badge');
    badge.hidden = !flags; badge.textContent = flags;
    const sevLabel = { ok: 'badge--good', warn: 'badge--warn', bad: 'badge--bad', info: 'badge--muted' };
    $('#health-grid').innerHTML = items.map((i) => `<div class="health ${i.sev}">
      <div class="health-head"><h3>${i.title}</h3><span class="badge ${sevLabel[i.sev]}">${i.sev === 'ok' ? '✓ ' : i.sev === 'warn' || i.sev === 'bad' ? '⚠ ' : 'ℹ '}${i.badge}</span></div>
      <div class="health-metric">${i.metric}</div>${i.body.filter(Boolean).map((b) => `<p>${b}</p>`).join('')}</div>`).join('');

    $('#date-audit').innerHTML = `<thead><tr><th class="l">Sheet</th><th class="l">Platform</th><th>DD-MM-YYYY</th><th>MM/DD/YYYY</th><th>ISO</th><th>Other</th><th>Swapped</th><th>Unreadable</th></tr></thead><tbody>` +
      M.dateStats.map((d) => `<tr><td class="l">${esc(d.sheet)}</td><td class="l">${esc(d.platform)}</td><td>${fmtInt(d.dmy)}</td><td>${fmtInt(d.mdy)}</td><td>${fmtInt(d.iso)}</td><td>${fmtInt(d.serial + d.other)}</td><td>${fmtInt(d.swapped)}</td><td>${fmtInt(d.bad + d.blank)}</td></tr>`).join('') + '</tbody>';
    $('#sku-map').innerHTML = `<thead><tr><th class="l">Model</th><th class="l">ASIN</th><th class="l">FSN</th><th class="l">Category</th><th class="l">Sub-category</th><th>MOP</th><th>Cost rate</th></tr></thead><tbody>` +
      M.models.map((m) => `<tr><td class="l">${esc(m.name)}${m.unmapped ? ' <span class="badge badge--bad">unmapped</span>' : ''}</td><td class="l">${esc(m.asin || '—')}</td><td class="l">${esc(m.fsn || '—')}</td><td class="l">${esc(m.cat)}</td><td class="l">${esc(m.sub)}</td><td>${fmtINRFull(m.mop)}</td><td>${m.cost == null ? '<span class="badge badge--warn">Missing</span>' : fmtINRFull(m.cost)}</td></tr>`).join('') + '</tbody>';
  }

  /* ---------- insights ---------- */
  function renderInsights() {
    const list = window.BAInsights || [];
    const api = insightApi();
    $('#insights-list').innerHTML = list.map((it, i) => {
      let live = null;
      try { live = it.live ? it.live(api) : null; } catch (e) { live = null; }
      return `<article class="insight"><div class="insight-n">${i + 1}</div>
        <div><h3>${it.title}</h3>${it.body.map((p) => `<p>${p}</p>`).join('')}<p class="act"><b>Action:</b> ${it.action}</p></div>
        ${live ? `<div class="insight-live"><div class="k">${live.k}</div><div class="v">${live.v}</div><div class="s">${live.s || ''}</div></div>` : '<div></div>'}</article>`;
    }).join('');
  }

  /** Unfiltered helpers for insight cards so their live numbers ignore the filter bar. */
  function insightApi() {
    const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
    const range = (a, b, pred = () => true) => M.sales.filter((s) => s.d >= a && s.d <= b && pred(s));
    const spendRange = (a, b, pred = () => true) => M.spends.filter((s) => s.d >= a && s.d <= b && pred(s));
    const last = (() => { const { y, m } = parts(M.dataMax); const eom = D(y, m + 1, 0); return eom === M.dataMax ? [D(y, m, 1), M.dataMax] : [D(y, m - 1, 1), D(y, m, 0)]; })();
    return { M, sum, range, spendRange, last, D, parts, shiftYear, fmtINR, fmtPct, fmtInt, fmtRange, signed, MON };
  }

  /* ---------- filter controls ---------- */
  function seg(el, options, value, onChange) {
    el.innerHTML = options.map((o) => `<button type="button" data-v="${esc(o.v)}" aria-pressed="${o.v === value}">${o.sw ? `<span class="swatch" style="background:${o.sw}"></span>` : ''}${esc(o.label)}</button>`).join('');
    el.onclick = (e) => { const b = e.target.closest('button'); if (b) onChange(b.dataset.v); };
  }

  function multiSelect(el, { placeholder, options, selected, onChange, searchable }) {
    const label = () => {
      if (!selected.size) return placeholder;
      if (selected.size === 1) { const o = options.find((x) => selected.has(x.v)); return o ? o.label : placeholder; }
      return `${selected.size} selected`;
    };
    const wasOpen = el.querySelector('.ms-panel') && !el.querySelector('.ms-panel').hidden;
    const prevQuery = el.querySelector('.ms-panel .input')?.value || '';
    el.innerHTML = `<button type="button" class="ms-btn ${selected.size ? 'has-value' : ''}" aria-haspopup="listbox">${esc(label())}</button>
      <div class="ms-panel" hidden>${searchable ? `<input class="input" type="search" placeholder="Search…" value="${esc(prevQuery)}" />` : ''}
      <div class="ms-list" role="listbox">${options.map((o) => `<label class="ms-opt" data-text="${esc((o.label + ' ' + (o.sub || '')).toLowerCase())}"><input type="checkbox" value="${esc(o.v)}" ${selected.has(o.v) ? 'checked' : ''}/><span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></label>`).join('') || '<p class="muted" style="padding:6px 8px">No options</p>'}</div>
      <div class="ms-foot"><button type="button" class="btn-link" data-act="all">Select all</button><button type="button" class="btn-link" data-act="clear">Clear</button></div></div>`;
    const btn = el.querySelector('.ms-btn'), panel = el.querySelector('.ms-panel');
    const filterList = () => {
      const q = (el.querySelector('.ms-panel .input')?.value || '').toLowerCase();
      el.querySelectorAll('.ms-opt').forEach((o) => { o.style.display = o.dataset.text.includes(q) ? '' : 'none'; });
    };
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.ms-panel').forEach((p) => { if (p !== panel) p.hidden = true; });
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('.input')?.focus();
    };
    panel.onclick = (e) => e.stopPropagation();
    panel.querySelector('.input')?.addEventListener('input', filterList);
    panel.addEventListener('change', (e) => {
      const v = e.target.value; const conv = options.find((o) => String(o.v) === v)?.v ?? v;
      if (e.target.checked) selected.add(conv); else selected.delete(conv);
      onChange(true);
    });
    panel.querySelector('[data-act="all"]').onclick = () => { options.forEach((o) => selected.add(o.v)); onChange(true); };
    panel.querySelector('[data-act="clear"]').onclick = () => { selected.clear(); onChange(true); };
    if (wasOpen) { panel.hidden = false; filterList(); }
  }

  function renderFilters() {
    seg($('#f-platform'), [{ v: 'All', label: 'All' }, ...M.platforms.map((p) => ({ v: p, label: p, sw: platformColor(p) }))], S.platform, (v) => { S.platform = v; renderAll(); });
    const cats = [...new Set(M.models.map((m) => m.cat))].sort();
    const subs = [...new Set(M.models.filter((m) => !S.cats.size || S.cats.has(m.cat)).map((m) => m.sub))].sort();
    for (const s of [...S.subs]) if (!subs.includes(s)) S.subs.delete(s);
    const models = M.models.filter((m) => (!S.cats.size || S.cats.has(m.cat)) && (!S.subs.size || S.subs.has(m.sub)));
    for (const id of [...S.models]) if (!models.some((m) => m.id === id)) S.models.delete(id);
    multiSelect($('#f-cat'), { placeholder: 'All categories', options: cats.map((c) => ({ v: c, label: c })), selected: S.cats, onChange: renderAll });
    multiSelect($('#f-sub'), { placeholder: 'All sub-categories', options: subs.map((c) => ({ v: c, label: c })), selected: S.subs, onChange: renderAll });
    multiSelect($('#f-model'), { placeholder: 'All models', searchable: true, options: models.map((m) => ({ v: m.id, label: m.name, sub: `${m.asin} · ${m.fsn}` })), selected: S.models, onChange: renderAll });
    $('#f-preset').value = S.preset;
    $('#f-from').value = toISO(S.from); $('#f-to').value = toISO(S.to);
    $('#f-from').min = $('#f-to').min = toISO(M.dataMin);
    $('#f-from').max = $('#f-to').max = toISO(M.dataMax);
    seg($('#trend-metric'), Object.entries(TREND_METRICS).map(([v, m]) => ({ v, label: m.label })), S.metric, (v) => { S.metric = v; renderAll(); });
    seg($('#trend-gran'), [{ v: 'daily', label: 'Daily' }, { v: 'weekly', label: 'Weekly' }, { v: 'monthly', label: 'Monthly' }], S.gran, (v) => { S.gran = v; S.granTouched = true; renderAll(); });
  }

  function autoGran() {
    if (S.granTouched) return;
    const len = S.to - S.from + 1;
    S.gran = len <= 45 ? 'daily' : len <= 190 ? 'weekly' : 'monthly';
  }

  function applyPreset(p) {
    S.preset = p;
    if (p !== 'custom') [S.from, S.to] = presetRange(p);
    autoGran();
  }

  /* ---------- render orchestration ---------- */
  function renderAll() {
    if (!M) return;
    renderFilters();
    const W = windows();
    const daily = buildDaily(allowedModels());
    // each section renders independently so one failure can't blank the rest
    const parts = [
      ['kpis', () => renderKpis(daily, W)],
      ['chart-trend', () => renderTrend(daily)],
      ['chart-platform', () => renderPlatform(W)],
      ['category-list', () => renderCategories(W)],
      ['chart-spend', () => renderSpend(daily, W)],
      ['state-list', () => renderGeo(W)],
      ['chart-age', () => renderAge(W)],
      ['sku-table', () => renderSku(W)],
    ];
    for (const [target, fn] of parts) {
      try { fn(); } catch (e) {
        console.error(`Render failed for #${target}:`, e);
        const el = document.getElementById(target);
        if (el) el.innerHTML = `<div class="callout callout--bad"><p><b>This section failed to render.</b> ${esc(e.message || e)}</p></div>`;
      }
    }
    for (const k of Object.keys(tables)) if (!$('#table-' + k).hidden) showTable(k);
  }

  function showTable(k) {
    const t = tables[k]; if (!t) return;
    $('#table-' + k).innerHTML = `<table class="data-table data-table--compact"><thead><tr>${t.cols.map((c, i) => `<th class="${i ? '' : 'l'}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i ? '' : 'l'}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderBanners() {
    const out = [];
    if (META.source === 'snapshot') {
      out.push(`<div class="callout callout--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <p><b>Showing the bundled snapshot (data through ${fmtDate(M.dataMax)}), not the live sheet.</b>
        ${META.liveError ? `Live sync failed: <code>${esc(META.liveError.message || META.liveError)}</code>.` : ''}
        To enable live sync, open the sheet in Google Sheets → <b>File › Save as Google Sheets</b> (if it is an .xlsx), then <b>Share › Anyone with the link › Viewer</b>, and put the new sheet ID in <code>assets/config.js</code> or append <code>?sheet=&lt;ID&gt;</code> to this URL.</p></div>`);
    }
    $('#banners').innerHTML = out.join('');
  }

  function renderSource() {
    const pill = $('#source-pill');
    pill.classList.remove('is-live', 'is-snapshot', 'is-error');
    const time = META.syncedAt ? META.syncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    if (META.source === 'live') {
      pill.classList.add('is-live');
      $('#source-text').textContent = `Live · synced ${time}`;
      pill.title = `Google Sheet ${META.sheetId}. Auto-refresh every ${CFG.refreshMinutes} min. Click to open the sheet.`;
    } else if (META.source === 'snapshot') {
      pill.classList.add('is-snapshot');
      $('#source-text').textContent = `Snapshot · loaded ${time}`;
      pill.title = 'Bundled CSV snapshot in /data. Live sync unavailable. See banner.';
    } else {
      pill.classList.add('is-error');
      $('#source-text').textContent = 'Load failed';
    }
    $('#footer-sync').textContent = M ? `Data ${fmtRange(M.dataMin, M.dataMax)} · ${fmtInt(M.sales.length)} sales rows · ${META.source === 'live' ? 'live Google Sheet' : 'snapshot'} · synced ${META.syncedAt ? META.syncedAt.toLocaleString() : '—'}` : '';
  }

  /* ---------- load / refresh ---------- */
  async function load(initial) {
    if (META.loading) return;
    META.loading = true;
    $('#refresh-btn').classList.add('spinning');
    if (!initial) document.body.classList.add('is-refreshing');
    try {
      const { raw, source, sheetId, liveError } = await window.BAData.loadRaw(CFG);
      const next = window.BAData.build(raw);
      const changed = !M || next.fingerprint !== M.fingerprint;
      const prevMax = M ? M.dataMax : null;
      Object.assign(META, { source, sheetId, liveError, syncedAt: new Date() });
      if (changed) {
        M = next;
        if (initial || S.preset !== 'custom') applyPreset(S.preset);
        else { S.from = Math.max(S.from, M.dataMin); S.to = Math.min(S.to, M.dataMax); }
        renderHealth();
        renderInsights();
        renderAll();
        if (!initial && prevMax != null && M.dataMax > prevMax) toast(`New data through ${fmtDate(M.dataMax)}`);
      }
      renderBanners();
      renderSource();
    } catch (e) {
      console.error(e);
      META.source = M ? META.source : 'error';
      renderSource();
      if (!M) $('#banners').innerHTML = `<div class="callout callout--bad"><p><b>Could not load data.</b> ${esc(e.message || e)}</p></div>`;
    } finally {
      META.loading = false;
      $('#refresh-btn').classList.remove('spinning');
      document.body.classList.remove('is-refreshing');
      $('#loading').classList.add('hidden');
    }
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'tooltip-pop';
    el.textContent = msg;
    Object.assign(el.style, { left: '50%', top: '72px', transform: 'translateX(-50%)' });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  /* ---------- wiring ---------- */
  function wire() {
    $('#f-preset').addEventListener('change', (e) => { S.granTouched = false; applyPreset(e.target.value); renderAll(); });
    const onDate = () => {
      const a = fromISO($('#f-from').value), b = fromISO($('#f-to').value);
      if (a == null || b == null) return;
      S.preset = 'custom';
      S.from = Math.max(M.dataMin, Math.min(a, b)); S.to = Math.min(M.dataMax, Math.max(a, b));
      S.granTouched = false; autoGran();
      renderAll();
    };
    $('#f-from').addEventListener('change', onDate);
    $('#f-to').addEventListener('change', onDate);
    $('#f-reset').addEventListener('click', () => {
      S.platform = 'All'; S.cats.clear(); S.subs.clear(); S.models.clear(); S.search = ''; $('#sku-search').value = '';
      S.granTouched = false; applyPreset('lastMonth'); renderAll();
    });
    document.addEventListener('click', () => document.querySelectorAll('.ms-panel').forEach((p) => (p.hidden = true)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.ms-panel').forEach((p) => (p.hidden = true)); });

    $('#sku-table').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const k = th.dataset.sort;
        S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: k === 'name' || k === 'sub' ? 1 : -1 };
        renderSku(windows()); return;
      }
      const tr = e.target.closest('tr[data-model]');
      if (tr) { const id = +tr.dataset.model; if (S.models.has(id)) S.models.delete(id); else S.models.add(id); renderAll(); }
    });
    $('#sku-search').addEventListener('input', (e) => { S.search = e.target.value; renderSku(windows()); });
    $('#sku-export').addEventListener('click', exportSku);

    document.querySelectorAll('[data-table-toggle]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tableToggle; const tv = $('#table-' + k), ch = $('#chart-' + k);
      const show = tv.hidden; tv.hidden = !show; ch.hidden = show;
      b.textContent = show ? 'View chart' : 'View data';
      if (show) showTable(k); else charts['chart-' + k]?.resize();
    }));

    $('#refresh-btn').addEventListener('click', () => load(false));
    $('#source-pill').addEventListener('click', () => {
      if (META.source === 'live' && META.sheetId) window.open(`https://docs.google.com/spreadsheets/d/${META.sheetId}/edit`, '_blank', 'noopener');
      else location.hash = '#banners';
    });
    $('#theme-btn').addEventListener('click', () => {
      const root = document.documentElement;
      const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = isDark ? 'light' : 'dark';
      try { localStorage.setItem('ba-theme', root.dataset.theme); } catch (e) { /* storage unavailable */ }
      renderAll();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderAll());

    // html tooltips for bar lists
    const pop = $('#pop');
    document.addEventListener('mousemove', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { pop.hidden = true; return; }
      pop.innerHTML = t.dataset.tip; pop.hidden = false;
      const x = Math.min(e.clientX + 14, innerWidth - pop.offsetWidth - 8), y = Math.min(e.clientY + 14, innerHeight - pop.offsetHeight - 8);
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    });

    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 120); });

    const every = Math.max(1, +CFG.refreshMinutes || 5) * 60000;
    setInterval(() => { if (!document.hidden) load(false); }, every);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && META.syncedAt && Date.now() - META.syncedAt.getTime() > every) load(false);
    });
  }

  wire();
  load(true);
})();
