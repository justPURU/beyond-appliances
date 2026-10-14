/*
 * Category-manager insights. Narrative written from data through 30 Sep 2026.
 * Each card's `live` function recomputes its headline from the current data,
 * so the number on the right stays true as the sheet grows.
 */
(function () {
  'use strict';

  const byName = (M, frag) => M.models.filter((m) => m.name.toLowerCase().includes(frag)).map((m) => m.id);

  window.BAInsights = [
    {
      title: 'Growth is launch-led: the new BLDC range is half the business, and Cube AC Black is being cannibalised',
      body: [
        'Aug–Sep 2026 GMV is <b>+319% YoY</b>, but <b>51%</b> of it comes from 7 models launched in May–Jun 2026 (Cube BLDC colourways, Cube 1400/1500 m³/hr, Lume). Like-for-like, the 7 legacy models grew <b>+104%</b>.',
        'Inside legacy, the former hero <b>Cube 60cm AC Black</b> grew only +65%, and its share of GMV fell from 37% (Sep 25) to 13% (Sep 26), as the Cube 1500 m³/hr BLDC (same price band, +₹3.7k) took its place. <b>Dorado 4-burner hob</b> is flat at −5% Aug–Sep YoY.',
      ],
      action: 'Treat AC Black vs Cube 1500 as one price ladder. Protect AC Black as the entry chimney and don\'t discount both at once. Put Dorado on a turnaround plan (content, price check vs competitors).',
      live: (A) => {
        const [a, b] = A.last;
        const ty = A.sum(A.range(a, b), (s) => s.gmv);
        const ly = A.sum(A.range(A.shiftYear(a), A.shiftYear(b)), (s) => s.gmv);
        const p = A.parts(a);
        return { k: `GMV · ${A.MON[p.m - 1]} ${p.y}`, v: A.fmtINR(ty), s: ly ? `YoY ${A.signed((ty / ly - 1) * 100, 0)}` : 'YoY n/a' };
      },
    },
    {
      title: 'Amazon pays ~2.3 pp more TACOS than Flipkart for the same GMV. The gap is DSP',
      body: [
        'Over 14 months Amazon and Flipkart each delivered ~50% of GMV, but Amazon TACOS is <b>9.6%</b> vs Flipkart <b>7.3%</b>. Amazon is the only platform running <b>DSP</b> (₹15.1 L, 26% of Amazon spend). Without DSP, Amazon TACOS is 7.1%, the same as Flipkart.',
        'CPC (~₹17.5) and CTR (~1.1%) are the same across Sponsored Products, Brands, Display and DSP, so DSP is not buying cheaper reach either. Ad spend has also stayed flat at ~₹8 L/month while GMV tripled, so TACOS fell from 15% (Sep 25) to 5.6% (Sep 26). Growth is not ad-led.',
      ],
      action: 'Run a 4-week DSP hold-out on Amazon (or cut it 50%) and move the budget to Sponsored Products on the BLDC winners. Judge it by Amazon GMV share vs Flipkart, which has no DSP.',
      live: (A) => {
        const [a, b] = A.last;
        const t = (p) => { const g = A.sum(A.range(a, b, (s) => s.p === p), (s) => s.gmv); const sp = A.sum(A.spendRange(a, b, (s) => s.p === p), (s) => s.spend); return g ? sp / g : null; };
        return { k: 'TACOS last full month', v: `${A.fmtPct(t('Amazon'))} vs ${A.fmtPct(t('Flipkart'))}`, s: 'Amazon vs Flipkart' };
      },
    },
    {
      title: 'Two leaking SKUs: Venato Blue DG-118 and Lume Designer take 13% of SP spend for 1.4% of GMV',
      body: [
        'Since launch these two models have absorbed <b>₹3.55 L</b> of Sponsored Products spend, with SKU-level SP TACOS of <b>30%</b> (Venato) and <b>14%</b> (Lume) against a range average under 2%. In Jul–Sep 2026 each one sold on only 13–20 of 92 days per platform, and SP TACOS was still 11% (Venato) and 6% (Lume).',
        'Venato Blue also has <b>no cost rate</b>, so nobody can see whether it makes money at all.',
      ],
      action: 'Cap SP bids on both now and redeploy to Cube 1500 / Black Granite (SP TACOS <2%). Before restarting, fix listing quality (images, A+), and check whether Lume\'s ₹22,990 price point needs an offer.',
      live: (A) => {
        const ids = new Set([...byName(A.M, 'venato'), ...byName(A.M, 'lume')]);
        const [a, b] = A.last;
        const spAll = A.spendRange(a, b, (s) => !s.alloc);
        const share = A.sum(spAll.filter((s) => ids.has(s.m)), (s) => s.spend) / (A.sum(spAll, (s) => s.spend) || 1);
        const g = A.range(a, b);
        const gShare = A.sum(g.filter((s) => ids.has(s.m)), (s) => s.gmv) / (A.sum(g, (s) => s.gmv) || 1);
        return { k: 'Share of SP spend vs GMV', v: `${A.fmtPct(share, 0)} vs ${A.fmtPct(gShare, 1)}`, s: 'Venato + Lume, last full month' };
      },
    },
    {
      title: 'Margin blind spot: 3 SKUs have no cost rate, including the fastest-growing colourway',
      body: [
        '<b>Burgundy BLDC</b>, <b>Venato Blue BLDC</b> and <b>Auriga 4-burner cooktop</b> have no cost rate. That is <b>9.7%</b> of all GMV and <b>11.6%</b> in Jul–Sep 2026. Burgundy alone is 7% of Q3 GMV and carries the highest SP spend of any model (₹2.4 L).',
        'The dashboard leaves them out of margin rather than assuming zero cost. The reported 43.9% gross margin therefore covers about 88% of GMV, and the gap is widening as Burgundy scales.',
      ],
      action: 'Get the three landed costs from finance/sourcing this week. Until then, quote margin as "on 88% of GMV".',
      live: (A) => {
        const [a, b] = A.last;
        const g = A.range(a, b);
        const share = A.sum(g.filter((s) => !s.costed), (s) => s.gmv) / (A.sum(g, (s) => s.gmv) || 1);
        return { k: 'GMV without cost rate', v: A.fmtPct(share, 1), s: 'last full month' };
      },
    },
    {
      title: 'Two feed gaps limit regional and net decisions: Flipkart geography and returns',
      body: [
        'Flipkart reports <b>no city</b>, and <b>51% of Flipkart geo units have no state</b> either. Regional planning is effectively Amazon-only: there, Maharashtra, UP and Gujarat make up 46% of units, and the top 6 cities are evenly spread at 5–6% each. Geo also covers only 139 of 426 days, so treat it as a sample.',
        '<b>Returns/Cancellations are 0 on every one of 6,662 rows.</b> For chimneys and hobs that is not credible (installation-led returns are typical), so “Net revenue” is currently just GMV.',
      ],
      action: 'Ask the Flipkart account manager for the Iris state-wise sales report, and pull the Amazon PI returns report. Both drop straight into the existing tabs.',
      live: (A) => {
        const H = A.M.health;
        const fk = H.locUnits.Flipkart || 0;
        return { k: 'Flipkart geo units without state', v: A.fmtPct(fk ? (H.locNoState.Flipkart || 0) / fk : null, 0), s: `Returns rows non-zero: ${A.fmtInt(H.returnsNonZero)}` };
      },
    },
  ];
})();
