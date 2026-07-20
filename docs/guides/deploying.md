# Deploying

> Deploying the Next.js frontend, the InsForge Deno functions, and the web chat widget.

## Three deploy targets

| Target | What it is | Where it lives |
|---|---|---|
| **Next.js app** | The frontend + API routes | The whole repo root (well, everything except `widget-src/`, `insforge/`, and `public/widget.js`) |
| **InsForge Deno functions** | Webhook handlers, job runner, webchat endpoints | `insforge/functions/` (9 entrypoints) |
| **Web chat widget** | The embeddable JS bundle | `public/widget.js` (built from `widget-src/`) |

You can deploy them independently. The Next.js app does not need the Deno functions to be deployed for the marketing pages to work; the widget can be served from any static host or even from the same Next.js app.

## Build order

1. **Build the widget** (so `public/widget.js` exists when the Next.js app starts serving static files).
2. **Build the Next.js app** (which picks up the new `public/widget.js`).
3. **Deploy the Deno functions** (independent of #1 and #2).

```bash
npm run build       # runs build:widget then next build
npm run build:widget
```

The first command is a shortcut. The build order matters if you're deploying the widget to a CDN separately — the widget is a static file (`public/widget.js`) that needs to be reachable at the URL the embed snippet points to.

## Deploying the Next.js app

### Vercel (recommended)

The Next.js app is plain App Router. Vercel will auto-detect it.

1. Push the repo to GitHub.
2. Import the project in Vercel.
3. Set environment variables:
   - `NEXT_PUBLIC_INSFORGE_URL`
   - `NEXT_PUBLIC_INSFORGE_ANON_KEY`
   - `INSFORGE_SERVICE_ROLE_KEY` (server-side only; do **not** expose to browser)
   - `NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL` — **see rewrites note below**
4. Build command: `npm run build` (which runs `build:widget` first).
5. Output: standard Next.js.

#### `proxy.ts` and rewrites

`next.config.mjs` has a `rewrites()` block that proxies `/functions/v1/*` to the InsForge functions domain (so the browser doesn't hit a cross-origin URL). Set `NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL` to your InsForge functions base URL (e.g. `https://<your-app>.functions.insforge.app`). If unset, rewrites are empty and the app will hit the InsForge functions URL directly.

### Other Next.js hosts

Any platform that supports Next.js 16 App Router (Netlify, Render, Fly.io, self-hosted Node) works. The build output is standard.

## Deploying the InsForge Deno functions

Use the InsForge CLI:

```bash
# Deploy all functions
insforge functions deploy --all

# Deploy a single function
insforge functions deploy sms-inbound
```

After deploying, note the functions base URL. It's typically `https://<your-app>.functions.insforge.app`. Set `NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL` in the Next.js app to this value.

### Function secrets

Each function reads from `Deno.env`:

| Variable | Required | Used by |
|---|---|---|
| `INSFORGE_BASE_URL` | yes | All functions |
| `INSFORGE_SERVICE_ROLE_KEY` | yes | All functions |
| `SERVICE_ROLE_KEY` | sometimes (fallback) | `process-jobs` and the shared SMS/email inbound/status webhook runtime |

Set these via the InsForge dashboard or CLI. The functions **must not** be reachable without these set.

### Deploy the functions

Use the checked-in deployment script:

```bash
npm run deploy:functions
```

The deployment script reads the explicit nine-function source manifest in `scripts/deploy-insforge-functions.mjs`; its test prevents entrypoints from being silently omitted. It first bundles all nine current source entrypoints into a disposable temporary directory, aborts before any remote update if a bundle fails, deploys those fresh self-contained bundles, and removes the temporary directory. It never deploys the potentially stale checked-in `_bundled/` artifacts. After deploying, note the functions base URL. It's typically `https://<your-app>.functions.insforge.app`. Set `NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL` in the Next.js app to this value.


### Verifying a deployment

Do not use the unauthenticated mock adapter to probe a deployment: deployed endpoints reject it even if `INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS` is set. Verify a real provider integration with a signed webhook sent to a receiving number or address configured for that same provider. A request without `x-provider` should fail closed:

```bash
# Should return 400 because the provider is mandatory.
curl -X POST https://<your-app>.functions.insforge.app/functions/v1/sms-inbound \
  -H "Content-Type: application/json" \
  -d '{"From":"+15551234567","To":"+15559876543","Body":"test","MessageSid":"test-1"}'
```

For a positive smoke test, use the provider's test tooling so the request carries a valid signature. A receiving route that is missing, inactive, or configured for another provider must be rejected rather than accepting a caller-supplied organization.

## Deploying the web chat widget

The widget is a single file: `public/widget.js`. It can be served from any static host.

### Option A: Next.js app (simplest)

If you serve the Next.js app, the widget is already at `/widget.js` (because `public/` is the static files root in Next.js). No extra deployment step.

Embed snippet:

```html
<script src="https://<your-nextjs-domain>/widget.js" data-widget-id="wt_xxx"></script>
```

### Option B: CDN

If you want a dedicated CDN URL for the widget:

1. Build: `npm run build:widget`. This produces `public/widget.js`.
2. Upload `public/widget.js` to your CDN (CloudFlare R2, S3, etc.).
3. Make it accessible at a stable URL.
4. Embed:

```html
<script src="https://cdn.your-domain.com/widget.js" data-widget-id="wt_xxx"></script>
```

The widget reads its own `src` to determine the app origin (used to call `/functions/v1/webchat-*` endpoints). So the script must be hosted on a URL whose origin matches your InsForge functions base URL — or you can host it on the same origin as the Next.js app, which is simplest.

## Environment variables checklist

Production requires:

| Variable | Where | Required |
|---|---|---|
| `NEXT_PUBLIC_INSFORGE_URL` | Next.js (browser + server) | yes |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | Next.js (browser) | yes |
| `INSFORGE_SERVICE_ROLE_KEY` | Next.js (server-only) | yes |
| `NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL` | Next.js (rewrite target) | recommended |
| `INSFORGE_BASE_URL` | Deno functions | yes |
| `INSFORGE_SERVICE_ROLE_KEY` | Deno functions | yes |
| `SERVICE_ROLE_KEY` | Deno functions (fallback) | optional |

Variables prefixed `NEXT_PUBLIC_` are exposed to the browser. Only the InsForge URL, anon key, and functions URL should be public. The service role key must remain server-side.

## Pre-deploy checklist

- [ ] All 18 migration files applied in the documented order (through `016`, including both timestamped job-trigger migrations).
- [ ] Migration `016` applied **before** deploying the updated routes/functions; inbound audit repair, job leases, decision idempotency, and knowledge revisions depend on it.
- [ ] Existing `knowledge-files` bucket set to **private** in the InsForge dashboard after applying `014`.
- [ ] Knowledge uploads use `<organization-id>/documents/...` object keys.
- [ ] Seed data applied (optional for production).
- [ ] At least one SMS or email provider account configured (if you want real inbound).
- [ ] At least one web chat widget configured (if you want to embed the widget).
- [ ] `NEXT_PUBLIC_DEMO_WIDGET_ID` unset in production (otherwise the landing page shows a demo chat button).
- [ ] `INSFORGE_SERVICE_ROLE_KEY` not in any browser-bundled env.
- [ ] `npm run lint` clean.
- [ ] `npm test` clean.
- [ ] `npm run build` succeeds.
