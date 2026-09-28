# Seed context — real operating data to model the demo dataset on

Agency: Influensia (brand), operated by Ledge Digital d.o.o. Team = Marko (admin, EU), Bogdan (agent, China), Cristina (agent, China). Two client organisations for the seed: **KOFF** (Polish B2B distributor; Bogdan's employer; sends most product lists) and **Piotr's team** (KOFF's customer, Allegro seller, the first platform client). Use fictional but plausible user emails (marko@influensia.ro, bogdan@…, cristina@…, piotr@example.pl, buyer@koff.example).

## Request / order to seed end-to-end: ORDER-2026-#312 — TCG accessories (client: Piotr's team via KOFF)
35 SKUs in the real order; seed 8 representative lines with codes KOFF-312-NN:
- KOFF-312-01 Standard sleeves 66×91 mm, 100 µm, PP, 100/bag — qty 100,000 pcs
- KOFF-312-02 Standard sleeves 66×91 mm, 80 µm — 100,000
- KOFF-312-03 Japanese size 62×89 mm, 100 µm — 50,000
- KOFF-312-05 Team bag 66×91 — 50,000
- KOFF-312-11 Toploader 35pt 76.2×103.2 mm, panel ≥0.305 mm, PVC-free — 20,000
- KOFF-312-14 Toploader 130pt — 5,000
- KOFF-312-20 Magnetic one-touch holder 35pt (pull ≥1.5 kg) — 5,000
- KOFF-312-26 Album/binder 9-pocket, 360 pockets, PP pages — 2,000
Spec notes: single-wall microns not 丝; virgin resin; PVC-free; FOB USD per single piece; photos are form reference not branding.
Cost floor for 100 µm sleeve: mass = L×W×2 walls×µm×0.91 g/cm³ → ~1.09 g/pc, resin floor ≈ $0.004; RFQ benchmark weight 104–114 g per 100. Target price for KOFF-312-01: ~$0.037/pc.

Suppliers contacted for the sleeves line (participation rows), with real-shaped quotes (USD/pc):
1. Dongguan Yuantuo Packaging Products Co., Ltd. — manufacturer, grade B, Shenzhen/Dongguan, contact Daryl Yang (email), FOB Shenzhen, T/T, lead 30 days, valid to 2026-09-30; quoted 01 $0.0539, 02 $0.045, 03 $0.052, 05 $0.0083 (declared 50 µm — deviation), 11 $0.15, 20 $2.10; declares g/100 weights (58/51/100). Status: negotiating → selected.
2. Yiwu Suti Crafts Co., Ltd. (义乌市苏媞工艺品有限公司) — trading (registered 2026-03, 100k CNY capital), grade D, contact Tim (Alibaba), FOB Ningbo, 50% deposit, lead 8–10 days, valid to 2026-09-08 (expired); quoted 01 $0.032, 02 $0.028, 03 $0.033, 11 $0.14. Status: dropped (reason: 6-month-old trader, double-wall micron suspicion).
3. "Quote B" 依立 (Yili) — 1688, unchecked, Chinese-only quote per bag of 100: 01 $0.0348, 02 $0.030; EXW; states 80/100 µm film. Status: quoted.
4. Guangdong Dr. Card Culture Co., Ltd. — manufacturer, contact via WeChat, quoted per pack, 40–45 days: 01 $0.0745. Status: quoted. (Same group as Guangdong Kepu.)
5. Quote D (anonymous xlsx) — MOQ 100,000 pcs, 10/10 SKUs: 01 $0.076. Status: quoted (backup).
6. Huizhou Boyuan Plastic Products — manufacturer, Alibaba, contacted, no quote yet. Status: contacted.
7. Wenzhou Fuli Packaging — manufacturer, contacted 15 days ago, no reply. Status: contacted (stale).
8. Zhongshan Jinou Hardware Products Co., Ltd. — manufacturer, WeChat/1688 (A金瓯卡具李小姐), cannot make sleeves (metal only). Status: cannot_make.

Offer to seed for KOFF-312-01: Option A (Yuantuo-based) $0.062/pc @100k incl. fee (factory $0.0539 + fee), MOQ 100,000, lead 30 d, deviations "none at spec thickness"; Option B (Quote D-based) $0.085/pc, MOQ 100,000, 40 d. Status: accepted (A). Sample: ordered 2026-09-10, received 2026-09-18, approved with 2 photos. Order ORD-2026-0312: confirmed 2026-09-20, deposit 30% + fee paid 2026-09-22, artwork approved, in production, ex-works ETA 2026-10-25, QC inspection scheduled; ETA Gdańsk 2026-11-18. Payments: deposit $1,860 paid; fee $540 paid; balance $4,340 due on QC pass.

## Other seeded requests (client KOFF), lighter
- SHEDS-3210 garden sheds — 3 lines (metal apex 201×181×190; resin 130×192×198; large store 460×312×194), state Quotes in; suppliers: Shandong Zhongjian (cannot make, plastic only), Qingdao Ecosino (FOB $8.30/set; payment 50/50 or 30/70 +$0.1), Keter-style resin factory (quoted).
- Work gloves red latex crinkle, size 10, 10,000 pairs — state Offer ready; Linyi Tongfu Safety Products (manufacturer, Tongfu Wang, Alibaba, EXW $0.205/pair).
- Icicle lights 500 LED / 24 m — state Negotiating; Nantong Stylish Lighting (Sarah Ji, Alibaba, FOB $8.40/set, breaks 500 $9.33 / 1000 $8.90 / 3000 $8.70).
- Boltless steel shelving 180×90×40 cm, 5-tier — state Delivered (completed order ORD-2026-0290, final $7.52/set black); Qingdao Ecosino selected. Use for the "previous order of this product" panel.
- Christmas tree 180 cm 507 tips PVC — state Finding factory; Yiwu Mali Tree (Sam Sun, FOB $59.99, 962 tips), Dongyang Xinhong (1688, EXW ¥254).
- Camping chair ULFUR ultralight 4-leg hub — state Draft (client submitted links only).

## Catalog (published products with reference price, all-in)
- Boltless steel shelving 5-tier 180×90×40 black — $8.90/set @1,000, FOB Qingdao, spec v2, valid to 2026-12-31
- Work gloves red latex crinkle — $0.26/pair @10,000, FOB Ningbo
- Icicle lights 500 LED 24 m — $9.90/set @1,000, FOB Ningbo
- Card sleeves 66×91 100 µm — $0.062/pc @100,000, FOB Shenzhen

## Factory range (for the selected sleeves supplier, shown as "Factory F-0042")
Items: Standard sleeves 66×91 (100/80/60 µm), Japanese 62×89, Team bag 66×91, Toploader 35/55/100/130pt, Magnetic holder 35pt, Deck box 100+, Binder 9-pocket. Each with MOQ and indicative USD price.

## Sourcing Tracker sheet columns (the internal board must feel like this, structured)
Company name | Company type (Baidu) | Contact name | Platform (Alibaba / 1688 / wechat / email / Global Sources) | Price | Incoterms | Other (MOQ, breaks, payment, country, certs, "cannot make")
Master index: Product (EN) | Link | Status (todo / in progress / negotiating price / done) | Who | Notes
