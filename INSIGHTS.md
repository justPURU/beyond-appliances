# Category Manager Brief: Kitchen Appliances on Amazon & Flipkart

*Data: 1 Aug 2025 – 30 Sep 2026 · 14 models (ASIN ↔ FSN unified) · ₹12.04 Cr GMV · 9,285 units · ₹1.02 Cr ad spend*

**Headline:** Sep 2026 GMV was **₹1.39 Cr, +344% YoY**, at a TACOS of **5.6%** (15.2% a year ago). The growth is real, but it is launch-led and unevenly funded. Two SKUs are leaking spend, and three data gaps mean margin and net revenue are not yet fully trustworthy.

---

### 1. Growth is launch-led, and Cube AC Black is being cannibalised
- **51%** of Aug–Sep 2026 GMV comes from 7 models launched in May–Jun 2026 (Cube BLDC colourways, Cube 1400/1500 m³/hr, Lume). Like-for-like, the 7 legacy models grew **+104%** against a total of +319%.
- The former hero **Cube 60cm AC Black** grew only +65%, and its GMV share fell from **37% (Sep 25) to 13% (Sep 26)**. The Cube 1500 m³/hr BLDC (₹15,990, +₹3.7k) has taken its slot. **Dorado 4-burner hob** is flat (−5% Aug–Sep YoY).
- **Action:** manage AC Black → Cube 1500 as one price ladder. Keep AC Black as the entry chimney and avoid discounting both together. Put Dorado on a content/price review.

### 2. Amazon pays ~2.3 pp more TACOS for the same GMV, and the gap is DSP
- GMV is split ~50/50, but TACOS is **Amazon 9.6% vs Flipkart 7.3%**. Only Amazon runs **DSP (₹15.1 L, 26% of Amazon spend)**. Without DSP, Amazon TACOS is **7.1%**, the same as Flipkart.
- CPC (~₹17.5) and CTR (~1.1%) are the same across SP, SB, Display and DSP, so DSP is not buying cheaper reach. Total spend stayed flat at ~₹8 L/month while GMV tripled, which means growth is not ad-led.
- **Action:** run a 4-week DSP hold-out (or a 50% cut) on Amazon and move the budget to Sponsored Products on the BLDC winners. Measure Amazon's GMV share against Flipkart (no DSP) as the control.

### 3. Two leaking SKUs: Venato Blue DG-118 and Lume Designer
- They take **₹3.55 L of SP spend (13% of all SP) for 1.4% of GMV**. SKU-level SP TACOS is **30% (Venato)** and **14% (Lume)**, against a range average under 2%.
- In Jul–Sep 2026 each sold on only **13–20 of 92 days** per platform. Venato also has **no cost rate**, so its profitability is unknown.
- **Action:** cap SP bids now and redeploy to Cube 1500 / Black Granite (SP TACOS <2%). Fix the listings (images, A+) and test an offer on Lume's ₹22,990 price point before restarting.

### 4. Margin blind spot: 3 SKUs have no cost rate
- **Burgundy BLDC, Venato Blue BLDC and Auriga cooktop** have no cost in SKU_Master. That is **9.7% of GMV** overall and **11.6% in Q3**. Burgundy alone is 7% of Q3 GMV and has the highest SP spend of any model (₹2.4 L).
- The dashboard leaves them out instead of assuming zero cost, so the **43.9% gross margin covers only ~88% of GMV**. The gap widens as Burgundy scales.
- **Action:** get landed costs from finance this week. Until then, quote margin as "on 88% of GMV".

### 5. Feed gaps: Flipkart geography and returns
- Flipkart reports **no city**, and **51% of Flipkart geo units have no state**. Regional planning is therefore Amazon-only. On Amazon, **Maharashtra, UP and Gujarat = 46%** of units, and the top 6 cities are flat at 5–6% each. Geo covers only 139 of 426 days, so it is a sample.
- **Returns/Cancellations = 0 on all 6,662 sales rows.** That is not credible for installed appliances, so "Net revenue" currently equals GMV.
- **Action:** request the Flipkart Iris state-wise report and the Amazon PI returns report. Both load into the existing tabs with no dashboard change.

---
*How the numbers are built:* ASIN↔FSN unified through SKU_Master · DD-MM-YYYY (Amazon) and MM/DD/YYYY (Flipkart) normalised · names cleaned · TACOS = SP + SB + Display + DSP ÷ GMV · Net = GMV − returns · DRR = units ÷ days · prev-period and YoY via date-shifted windows. See the dashboard's **Data health** section for every flag.
