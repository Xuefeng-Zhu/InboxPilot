# Analytics dashboard — design hand-off

**Card:** `[P2] Analytics dashboard visual design` (`t_design_analytics_dashboard`)
**Feeds:** `[P1] Analytics dashboard` (`t_eng_analytics_dashboard`)
**Owner:** design
**Status:** ready for eng review
**Files:**
- `docs/design/analytics.html` — all 6 frames in one self-contained HTML file. Open in a browser; no build step.
- `docs/design/analytics.md` — this document.

---

## 1. Reader, goal, and the 5-second contract

The page is for a **support lead**, the kind of person who checks it on a laptop between tickets and on a phone on the bus. The job of the page is to answer one question: **"are we ok this week?"** The design treats that as a literal 5-second scan, not as a tagline.

The scan path is fixed and short:

1. **Status pill** in the top right of the page header — forest / ochre / terra, with a one-line reason.
2. **Six KPI tiles** in a single row — value + delta + sparkline.
3. **Three trendline charts** stacked horizontally with a shared x-axis.
4. **Drilldown tables** — top-10 keywords, top-10 contacts, channel split.

If the pill is red, the rest is post-mortem detail. If the pill is green, the lead closes the tab. The middle states are where the page earns its keep.

## 2. What changed in the design

The existing `app/analytics/page.tsx` is a `max-w-4xl` page with a `MetricCard` that takes a `color: 'gray' | 'blue' | 'green' | 'yellow' | 'purple'` prop and renders the same blue/green/yellow tailwind palette. It computes six metrics on every load with a 10,000-row client-side filter and a 5,000-row inner message loop — fine for an MVP, but the visual is stock Tailwind, and there are no trends, no drilldowns, no mobile story, and no shared status indicator.

The new design replaces that with:

- A **status pill** as the first thing the lead sees. Computed from the worst of the six tiles; never averaged.
- **Six KPI tiles** with sparklines, with per-tile color thresholds.
- **Three trendline charts** that share an x-axis (Jun 02 → Jun 08) and a chart height, so the eye can compare slopes without re-orienting.
- **Three drilldown tables** with sortable columns and per-table CSV export.
- A **mobile layout** that collapses the dashboard to a single column with sparklines on the right of each card.
- **A documented threshold table** so eng can encode the rules directly.

## 3. Aesthetic direction

**"Linen"** — same family as the knowledge-base page (`docs/design/spec.md`, `docs/design/index.html`). Intentionally not the default Tailwind blue/green/red.

- Warm off-white page (`#FAF8F4`), pure white cards on a 1 px linen border.
- **Fraunces** for display (page title, chart titles, mobile h1).
- **IBM Plex Sans** for body, KPI labels, table cells.
- **IBM Plex Mono** for numerics, deltas, table columns, CSV export buttons, x-axis labels.
- Tinted status colors (forest / ochre / terra) — never bright red/green, never on a colored fill, only on borders, sparkline strokes, and status pills.
- Hairline borders, no heavy shadows. Cards sit on the page, not float over it.

Cross-product consistency is the point. The knowledge-base page is editorial; the analytics page is information-dense; the same warm chrome and the same font family keep them feeling like one product.

## 4. Token reuse (from the knowledge-base spec)

The analytics spec reuses the same token names and hex values. No new tokens are introduced.

| Token         | Hex       | Use in analytics                                |
|---------------|-----------|--------------------------------------------------|
| `--bg`        | `#FAF8F4` | Page background                                  |
| `--surface`   | `#FFFFFF` | KPI tiles, chart cards, tables                   |
| `--surface-2` | `#F4F0E6` | Subtle tint, topbar, table header strip         |
| `--ink`       | `#1A1815` | Primary text, KPI value, page title              |
| `--ink-2`     | `#6B655C` | Secondary text, delta suffix, channel-bar label  |
| `--ink-3`     | `#9A9386` | Tertiary — "vs prior 7d", x-axis labels, sort arrow |
| `--line`      | `#E8E2D6` | Hairlines between rows, between tiles, table borders |
| `--line-2`    | `#D7CFBE` | Stronger borders, CSV export button              |
| `--teal`      | `#0E5E5E` | Primary accent — focus ring, AI-resolved series, active tab, web nav |
| `--teal-2`    | `#0A4848` | Primary hover                                    |
| `--teal-soft` | `#E4EEEE` | AI-resolved sparkline fill, EMAIL chip            |
| `--forest`    | `#4A7C3F` | Healthy — pill, sparkline, "up" deltas            |
| `--forest-bg` | `#EEF3E8` | Healthy fill                                     |
| `--ochre`     | `#B8761E` | Watch — pill, sparkline, "up" delta on inverse    |
| `--ochre-bg`  | `#F6ECDC` | Watch fill, SMS chip                             |
| `--terra`     | `#A8331F` | Action — pill, sparkline, threshold line         |
| `--terra-bg`  | `#F5E2DC` | Action fill                                      |
| `--slate`     | `#6B655C` | Flat / inactive — flat delta, "Queued" tint       |
| `--slate-bg`  | `#EFEBE0` | Flat fill, Volume series on the trendline panel   |

If eng needs to add per-tenant color overrides, do it via a single CSS variable override on `<body data-tenant="…">` — don't fork the palette.

## 5. Type

| Role                | Family          | Weight | Size  | Line height | Letter spacing       |
|---------------------|-----------------|--------|-------|-------------|----------------------|
| Page title (h1)     | Fraunces        | 500    | 32 px | 1.10        | -0.015 em            |
| Section heading     | Fraunces        | 500    | 18 px | 1.30        | 0                    |
| Chart card title    | IBM Plex Sans   | 500    | 13 px | 1.40        | 0                    |
| KPI value           | Fraunces        | 500    | 32 px | 1.05        | -0.02 em             |
| KPI label (eyebrow) | IBM Plex Mono   | 500    | 10 px | 1.00        | 0.08 em (uppercase)  |
| KPI delta           | IBM Plex Mono   | 400    | 11 px | 1.00        | 0                    |
| Table cell          | IBM Plex Sans   | 400    | 12.5 px | 1.50      | 0                    |
| Table header        | IBM Plex Mono   | 500    | 10 px | 1.00        | 0.08 em (uppercase)  |
| Channel bar label   | IBM Plex Sans   | 400    | 13 px | 1.50        | 0                    |
| Channel bar value   | IBM Plex Mono   | 400    | 12 px | 1.50        | 0                    |
| Status pill         | IBM Plex Sans   | 500    | 12 px | 1.00        | 0                    |
| Eyebrow (analytics) | IBM Plex Mono   | 400    | 11 px | 1.00        | 0.08 em (uppercase)  |

Load via Google Fonts: `Fraunces` (variable, opsz 9..144), `IBM Plex Sans` (400/500/600), `IBM Plex Mono` (400/500).

## 6. Color thresholds (the "are we ok?" contract)

The status pill, the KPI tile border, and the chart threshold line all read from **one** threshold table. Defaults are below; per-tenant overrides live in `tenant_settings.thresholds` (JSON column, schema in `docs/DATABASE.md`).

| Metric          | Healthy                          | Watch                          | Action                              | Polarity         |
|-----------------|----------------------------------|--------------------------------|--------------------------------------|------------------|
| Volume          | Within ±20% of prior 7d          | ±20–50% of prior 7d            | ±50% or more                         | neutral          |
| AI-resolved     | ≥ 60% of processed               | 40–59%                         | < 40%                                | higher is better |
| Escalated       | < 5% of volume AND < 8/day      | 5–10% OR 8–25/day              | > 10% OR > 25/day                    | lower is better  |
| First response  | ≤ 5 min median                   | 5–15 min                       | > 15 min                             | lower is better  |
| Open backlog    | ≤ 30 conversations               | 31–75                          | > 75                                 | lower is better  |
| CSAT            | ≥ 4.0 / 5 AND ≥ 80% positive    | 3.5–3.9 OR 70–79%              | < 3.5 OR < 70%                       | higher is better |

**Page-level pill rule** (worst-of, never averaged):

| Pill state  | Condition                                | Pill copy                              |
|-------------|------------------------------------------|----------------------------------------|
| Healthy     | All 6 tiles green                         | `Healthy` (no suffix)                   |
| Watch       | At least one tile yellow, none red        | `Watch · <metric> <direction>` (e.g. `Watch · escalations climbing`) |
| Action      | At least one tile red                     | `Action · <metric> <direction>` (e.g. `Action · first response > 15 min`) |

Polarity in the copy uses an inversion — "climbing" is a *bad* direction for escalations but a *good* one for volume. The `direction` string is computed from the same delta sign, with the polarity baked in.

**Tier rendering rules:**

- Healthy: no border color (default `--line`), forest on sparkline + delta.
- Watch: 1 px ochre border on the offending tile; ochre on sparkline + delta.
- Action: 1 px terra border on the offending tile; terra on sparkline + delta + chart threshold line.
- Flat (0% delta): slate on delta, slate hairline on sparkline. Not flagged.

**Inverse polarity** for escalations and (when already fast) first-response time:

```
"up" delta  → terra fill
"down" delta → forest fill
```

The semantic "we're going the wrong way" reads correctly without a per-metric copy edit.

## 7. Copy table (verbatim)

All copy is final. Do not rewrite, do not "improve". This is what the eng build ships.

### Page header

| Field    | Copy                                                                       |
|----------|-----------------------------------------------------------------------------|
| Eyebrow  | Analytics                                                                   |
| Title    | This week in support                                                        |
| Subtitle | `Mon DD Mmm — Sun DD Mmm YYYY · all channels · <window> compared to the prior <window>.` |

### Status pill

| State    | Copy                                |
|----------|--------------------------------------|
| Healthy  | `Healthy`                            |
| Watch    | `Watch · <metric> <direction>`       |
| Action   | `Action · <metric> <direction>`      |

Direction strings: `climbing` (inverse — bad), `rising` (neutral — bad), `dropping` (neutral — bad), `improving` (inverse — good), `faster`, `slower`, `unchanged`, `steady`.

### KPI tile labels (left-to-right)

| #  | Label              | Unit format                          | Polarity       |
|----|--------------------|---------------------------------------|----------------|
| 1  | Volume             | plain integer                         | neutral        |
| 2  | AI-resolved        | `count / total` (e.g. `812 / 1,284`)  | higher is better |
| 3  | Escalated          | `count / total`                       | lower is better (inverse) |
| 4  | First response     | `Xm Ys` (e.g. `2m 14s`)              | lower is better (inverse when already fast) |
| 5  | Open backlog       | plain integer                         | lower is better |
| 6  | CSAT               | `X.X / 5`                             | higher is better |

### KPI delta suffix

| Tile              | Suffix                       |
|-------------------|------------------------------|
| Volume            | `vs prior 7d`                |
| AI-resolved       | `<pct>% rate`                |
| Escalated         | `<pct>% rate`                |
| First response    | `vs prior 7d`                |
| Open backlog      | `unchanged` (when 0% delta)  |
| CSAT              | `<pct>% positive`            |

### Date range picker

Presets: `24h`, `7d`, `30d`, `90d`. Active preset is a 1 px line-bordered chip on `--surface`; others sit on `--surface-2`.

Range label: `DD Mmm → DD Mmm` (e.g. `Jun 02 → Jun 08`) in `--mono`.

### Trendline section

| Field    | Copy                                                     |
|----------|----------------------------------------------------------|
| H2       | Volume vs AI-resolved vs Escalations                     |
| Sub      | Daily counts · last 7 days · all channels                |
| Legend   | Volume · AI-resolved · Escalated                         |
| X-axis   | Mon, Tue, Wed, Thu, Fri, Sat, Sun                         |

### Drilldown tables

| Table                    | H2                          | Count chip      | Default sort |
|--------------------------|-----------------------------|------------------|--------------|
| Top escalation keywords  | `Top escalation keywords`   | `10`            | count desc   |
| Top contacts             | `Top contacts`              | `10`            | convos desc  |
| Channel split            | `Channel split`             | `7d`            | share desc   |

Table column headers (left-to-right):

- **Top escalation keywords:** Keyword · Count · Δ
- **Top contacts:** Contact · Convos · Channel
- **Channel split:** Name · bar · %

CSV button: `CSV` (uppercase, mono).

## 8. KPI tile anatomy

```
┌──────────────────────────────────┐
│ LABEL                  i  ← info │  ← eyebrow, mono 10/uppercase
│                                  │
│  1,284                           │  ← value, Fraunces 32
│  ▲ 8.2%        vs prior 7d      │  ← delta, mono 11
│                                  │
│  ╱╲╱─╲╱╲╱──                       │  ← sparkline, 28 px tall
└──────────────────────────────────┘
```

Total height: 132 px desktop, ~76 px mobile (compact).

The info button (`i` in a circle) opens a popover on hover/focus with the metric definition. The popover copy is in the copy table above.

## 9. Trendline chart anatomy

A trendline card is a 1 px border box with:

1. Header row: metric name (left) + total + percent (right, mono).
2. Chart area: 140 px desktop, 60 px on the mobile mini-trend, 44 px on the per-metric mobile card.
3. X-axis label row: monospace 9 px, one tick per day, with the same x-positions across all three charts (shared x-axis).
4. Threshold line: 1 px terra dashed at the action threshold, only on charts that have one. Threshold value labeled at the right edge, mono 9 px.
5. End-of-week point: 2.5 px filled circle. When the most-recent day is the highest value, add a 6 px halo so the eye lands on "today".

For all three trendlines, render in this order: `Volume` first (neutral), then `AI-resolved` (teal), then `Escalations` (terra, on top because it's the most actionable). The legend matches.

## 10. Drilldown table anatomy

- Header row: title + count chip on the left, `CSV` button on the right.
- Column header strip: 1 px top border, `--surface-2` background, mono 10 px uppercase.
- Sortable column header: clicking sorts asc/desc, active column gets a teal arrow.
- Row hover: `--surface-2` background.
- Row text: 12.5 px IBM Plex Sans. Numbers in mono, right-aligned.
- Avatar color in the contacts table: 22 px circle, first two initials, deterministic background derived from the contact id (same hash used in the inbox page — eng should reuse the helper).
- Channel chip colors: EMAIL=teal, SMS=ochre, WEB=slate, VOICE=purple.
- "Top row pinned with teal left-border" is in the design intent but not in the v1 cut — see open questions.

## 11. Mobile rules

The 1-column collapsed layout is a separate design pass, not just `flex-direction: column`. Specifically:

- All KPI tiles become `m-kpi` cards with the sparkline on the right (not below).
- KPI tile height drops to ~76 px so the lead can fit 4–5 cards in a thumb-scroll.
- The trendline section becomes one combined "Trendlines" card with all three series on a 60 px shared axis, then a per-metric `t-row` with its own 44 px axis below it.
- The status pill moves to the page header; the date range is a single mono line.
- Order of cards: **status pill → most concerning KPI → remaining KPIs by recency-of-decline → trendlines → per-metric cards → bottom nav**.
- The drilldown tables (top-10 keywords, top-10 contacts, channel split) move to a dedicated `Drill in` screen behind a CTA at the bottom of the trendline section. That screen is out of scope for this hand-off; eng can build it from the same TableCard component.

## 12. State machine (eng)

The page itself is mostly stateless — date range in, metrics out. But each KPI tile has the same health state:

```
   compute thresholds
        │
        ▼
   ┌─────────┐  ◀──────── prior 7d window
   │ healthy │  ──────────▶ tile border: --line
   └─────────┘               delta bg: --forest-bg
        │                   sparkline: --forest
        │ crosses watch band
        ▼
   ┌─────────┐
   │  watch  │  ──────────▶ tile border: --ochre
   └─────────┘               delta bg: --ochre-bg
        │                   sparkline: --ochre
        │ crosses action band
        ▼
   ┌─────────┐
   │ action  │  ──────────▶ tile border: --terra
   └─────────┘               delta bg: --terra-bg
        │                   sparkline: --terra
        │                    + chart threshold line
        │                    + page pill → red
        │
        │ value returns inside healthy band
        ▼
   (back to healthy)
```

The page-level pill is recomputed on every render: `worst(tileState for tile in tiles)`. No animation on tier change — the eye should catch it instantly.

## 13. Component breakdown (eng)

Reuse the existing `useAuth` and `useRealtime` hooks; the current `app/analytics/page.tsx` keeps the data fetch and just replaces the JSX.

| Component                | Path suggestion                                  | Notes |
|--------------------------|---------------------------------------------------|-------|
| `StatusPill`             | `components/analytics/StatusPill.tsx`             | Reads `worstTile` from context; takes `state` + `reason`. |
| `DateRangePicker`        | `components/analytics/DateRangePicker.tsx`        | Preset tabs + custom range. Reuse the existing one if it already exists in `components/inbox/`. |
| `KpiTile`                | `components/analytics/KpiTile.tsx`                | Single tile. Props: `label`, `value`, `unit`, `delta`, `deltaSuffix`, `sparkline` (array of 7 numbers), `state`, `polarity`. |
| `Sparkline`              | `components/analytics/Sparkline.tsx`              | Pure presentational SVG. 28 px desktop, 32 px mobile. Stroke is 1.25 px desktop, 1.5 px mobile. |
| `Trendline`              | `components/analytics/Trendline.tsx`              | 220 × 140 SVG with shared x-axis, optional threshold line. |
| `DrilldownTable`         | `components/analytics/DrilldownTable.tsx`         | Generic. Props: `title`, `count`, `columns`, `rows`, `csvHref`. |
| `ChannelBars`            | `components/analytics/ChannelBars.tsx`            | Horizontal bar list. Reused on desktop and mobile. |
| `DrilldownSection`       | `components/analytics/DrilldownSection.tsx`       | Wraps the three tables in a 3-col grid on desktop, stacked on mobile. |
| `MobileTrendline`        | `components/analytics/MobileTrendline.tsx`        | The combined mini-trend on the mobile layout. |

Use **Tremor** for the line chart and bar chart primitives (see section 15). Use **hand-rolled SVG** for the sparkline (Tremor's `Spark` is fine too, but a 1-file `Sparkline` component is faster to ship and easier to match the Linen palette exactly).

## 14. Accessibility checklist

- Status pill: `role="status"`, `aria-live="polite"`. Screen reader reads `<state> · <reason>`.
- Date range picker: both presets and custom range are keyboard-reachable. `aria-label="Date range"`.
- KPI tile: `role="group"`, `aria-label="<metric>, <value> <unit>, <delta direction> <pct> percent, <state>"`. Info button gets `aria-label="What does this mean"`.
- Sparkline: `aria-hidden="true"`. The numeric delta carries the data; the sparkline is decoration.
- Trendline chart: `role="img"`, `aria-label="<metric> from <date> to <date>, peak <n> on <day>, ended at <n>"`. The actual numbers also live in the table below for screen readers that don't expose `aria-label` cleanly.
- Threshold line: drawn as a `<line>` with `aria-label="Action threshold at <value>"`. Eng can render it as an annotation overlay.
- Drilldown tables: real `<table>`, `<th>` with `aria-sort="ascending|descending|none"`. CSV button is `<button>` with `aria-label="Download <table name> as CSV"`.
- Color is never the only signal — every tile has a label, every state has a reason string, every delta has a directional arrow.
- Focus ring: 2 px `--teal` outline, 2 px offset, applied via `:focus-visible`. Never use `outline: none` without a replacement.
- Mobile: bottom nav is real `<nav>` with `aria-label="Primary"`. The status pill is the first focusable element on the page (after the skip link).

## 15. Chart-library recommendation

**Use Tremor (`@tremor/react`, Apache 2.0).** Pair with hand-rolled SVG for the sparkline.

Why Tremor, specifically:

- **It is built for this exact shape of page** — KPI cards, line charts, bar lists. Every component in the spec maps to a Tremor primitive with no fudging.
- **Apache 2.0**, no surprise license, no per-seat fee, no telemetry, ships plain React. InboxPilot already uses Tailwind, so the existing theme tokens feed straight in via `tailwind.config.ts`.
- **Composes with Recharts under the hood**, so anything Tremor doesn't have (an annotation overlay, the terra threshold dashed line) can drop down to a Recharts `ReferenceLine` without leaving the stack.
- **Small** — the three primitives we need (Card, AreaChart, BarList) plus their chart wrappers add ~80 kB gzipped. That's cheap.
- **Server-render friendly** — supports RSC and hydration cleanly, which the rest of the InboxPilot app already assumes.

Why not the alternatives:

- **Recharts alone**: fine for the trendlines, but no built-in KPI tile or bar-list primitive, and its default animation style is the "Apple keynote bounce" the spec explicitly wants to avoid. We'd hand-roll the KPI tile anyway.
- **Visx**: would give us pixel-perfect control, but the eng team would spend 3–4 days on layout, axes, and tooltips for what Tremor ships in an afternoon. Not worth it for three line charts.
- **Nivo**: heavier than Tremor (~140 kB gz), more chart types than we need, and its color palette requires override work to match Linen. No clear win.
- **Custom SVG only**: yes for the sparkline (and that's what the spec uses in the HTML frames), no for the trendline. Drawing shared axes, grid lines, and threshold annotations by hand is a 1-day tax per chart that doesn't pay back.

**Net**: Tremor for the line chart and bar list, hand-rolled `<svg>` for the sparkline. Pin Tremor to a major version in `package.json` to insulate against breaking changes in the Recharts upgrade path.

## 16. Implementation notes (eng)

- The current `app/analytics/page.tsx` already queries `conversations` and `messages`. Keep that, and add three derived queries: a 7-day daily volume series, a daily AI-resolved series, and a daily escalations series. The trendline component takes three arrays of length 7.
- The top-10 keyword and contact tables already have the data — they need new server functions (or client-side aggregation) for "top 10 in window" with counts and week-over-week deltas. The CSV export is a `URL.createObjectURL(new Blob([csvString], { type: 'text/csv' }))` against the sorted rows.
- Polarity and threshold logic belongs in a single `lib/analytics/tiers.ts` module — the page pill, the tile border, and the chart threshold line all import from it.
- The page is read-only for now. The "Compare to prior period" callout under the title is a `<details>` element, not a modal — opens inline. Out of scope for v1.
- Add a `/analytics` route already exists. The only file change is the JSX inside `app/analytics/page.tsx`, plus the new components under `components/analytics/`.

## 17. Open questions for eng

1. **CSAT data source** — `csat_responses` doesn't exist as a table yet (no mention in `docs/DATABASE.md`). Is the field coming from a survey integration, or is the tile a placeholder for v2?
2. **Threshold overrides** — `tenant_settings.thresholds` is the right home, but it doesn't exist either. Eng should add a JSONB column with the default values from this spec and a small admin UI for the per-tenant override. Flag if there's a different preference.
3. **Time zone** — the date range reads "Mon 02 Jun — Sun 08 Jun" in the lead's local time, or in the org's time zone? The Linen spec is silent; the existing `app/analytics/page.tsx` uses ISO strings. Recommend org-time, but the data layer should expose the choice.
4. **Hourly vs daily granularity** — the 24h preset should be hourly, the 7d preset daily, the 30d preset daily, the 90d preset weekly. Eng should confirm the 90d bucket size; the trendline component will need a `bucket: 'hour' | 'day' | 'week'` prop.
5. **CSV row limit** — currently "top 10", but if eng wants "top 10 + scroll to page 2", that's a different component. The spec is intentionally top-10 only.
6. **Polarity on "First response"** — the spec calls it inverse when already fast (under 5 min, a "down" delta is good). Eng should encode the same rule. If a tenant has an SLA over 5 min, the inverse flag is wrong and the logic should fall back to lower-is-better.
7. **"Top row pinned with teal left-border"** — design intent, not in v1. The status pill already does the pinning job; we don't need a second one. Confirm before eng builds it.

None of these block the visual hand-off. Frame the answers as decisions in the eng task card; the design profile will pick up any visual deltas.

## 18. Files delivered

- `docs/design/analytics.html` — all 6 frames (desktop 1280 + mobile 390) in one self-contained HTML file. Open in a browser; no build step.
- `docs/design/analytics.md` — this document.

No Figma file is produced (we don't have a Figma seat in this environment). The HTML renders pixel-faithful to the intended Figma file: same copy, same hierarchy, same tokens, same chart shapes. Eng can build directly from `analytics.html` and `analytics.md`.
