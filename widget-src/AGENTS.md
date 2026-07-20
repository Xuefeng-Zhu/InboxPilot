# widget-src/ — Embeddable Web Chat Widget

**Always loaded** for any work on the third-party chat widget, the Vite build, or the embed script.

## OVERVIEW
Standalone Vite project that builds a single-file IIFE bundle to `public/widget.js`. **No React, no UI framework, no SDK imports** — vanilla TypeScript so the bundle stays small (3,905 B minified) and has zero supply-chain exposure to a third-party site's CSP.

## STRUCTURE
```
widget-src/
├── package.json        vite ^5.3.0, terser ^5.31.0 (no deps, only devDeps)
├── tsconfig.json       ES2020, strict, DOM lib
├── vite.config.mts     ESM Vite library config, IIFE output to ../public/widget.js, minified
└── widget.ts           The actual embeddable snippet (246 LOC, vanilla TS)
```

## THE EMBED SCRIPT
A third-party site drops exactly this:
```html
<script src="https://app.inboxpilot.com/widget.js"
        data-widget-id="wt_abc123"
        data-position="bottom-right"
        data-color="#2563eb"></script>
```

What it does on load:
1. Finds the last `<script data-widget-id>` tag and no-ops if missing.
2. Reads `data-position` (default `bottom-right`) and `data-color` (default `#2563eb`).
3. **Infers the app origin from `script.src`** — same bundle works against staging/prod/custom domains with no rebuild.
4. Pulls a per-widget visitor JWT from `localStorage` (key `inboxpilot:visitorToken:<widgetId>`), validates `exp` (5-min skew).
5. Renders a 56px circular floating button (fixed, `z-index: 2147483647`) and a 380×520 hidden iframe container.
6. On first click, calls `POST /functions/v1/webchat-thread-init`. On subsequent opens, calls `GET /functions/v1/webchat-session-info`.
7. Mounts the iframe at `<appOrigin>/wchat/<widgetId>?t=<token>&color=<color>[&prechat=1]`.
8. Cross-frame `postMessage` with origin check: handles `inboxpilot:close`, `inboxpilot:token_rotated`, `inboxpilot:auth_expired`.

## BUILD FLOW
- `npm run build` (root) → `npm run build:widget` (which `cd widget-src && npm run build`) → Vite builds to `../public/widget.js` → `next build` consumes it.
- `widget-src` has no HMR — its `dev` script is `vite build --watch` (rebuilds on change; the dev server picks up the new `public/widget.js`).

## WHERE TO LOOK
- **Change the floating button position, color, or size** → `widget.ts` (the IIFE that renders the launcher).
- **Change the iframe dimensions** → `widget.ts` (default 380×520).
- **Add a new `data-*` attribute** → `widget.ts` (read it via `scriptTag.getAttribute('data-…')`).
- **Add a new realtime message type** → `widget.ts` (the `postMessage` handler at the bottom).
- **Change the widget-token localStorage key** → `widget.ts` (default `inboxpilot:visitorToken:<widgetId>`).

## CRITICAL RULES
1. **Never hand-edit `public/widget.js`** — it's built by Vite from `widget-src/widget.ts`. Edit source, then rebuild.
2. **The widget must work against any InsForge deployment** with no rebuild — app origin is inferred from `script.src`.
3. **The widget bypasses `proxy.ts` auth** (the iframe page is in the allowlist) — visitor JWT is in the URL `?t=`.
4. **No external runtime deps** — vanilla TS only. CSP-friendly.

## CONVENTIONS
- **Single IIFE output** (`vite.config.mts` sets `formats: ['iife']`, `emptyOutDir: false`, terser minify).
- **No polyfills** — relies on `fetch`, `URL`, `localStorage`, `postMessage` (all universally available in modern browsers).
- **Console output is `console.warn` only** (and only for misconfig like missing `data-widget-id`). No `console.log`.
- **Origin-checked `postMessage`** — every message handler verifies `event.origin` against the inferred app origin.

## ANTI-PATTERNS
- Adding a runtime npm dep (defeats the zero-dep purpose; may break third-party CSPs).
- Hand-editing `public/widget.js`.
- Using `localStorage` without a widget-id-prefixed key (different widgets on the same page would collide).
- Hardcoding an InsForge URL (always infer from `script.src`).
- Logging visitor tokens to console.

## UNIQUE
- **The only Vite project in the repo** — all other frontend code goes through Next.js.
- **Builds directly into Next.js's `public/`** — no separate CDN.
- **3,905 bytes minified** — extremely small surface for what it does.
- **The `widget-src` package has its own `package-lock.json`** (it's a standalone Vite project, not an npm workspace).
- **No tests** — the widget is a self-contained snippet; manual QA against a staging embed is the only verification.
- **The `STITCH_API_KEY` referenced in `.kiro/settings/mcp.json`** is used to generate design mockups like the widget's UI (separate from the widget code itself).
