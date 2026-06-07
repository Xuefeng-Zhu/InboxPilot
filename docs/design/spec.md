# Knowledge base — design hand-off

**Card:** `[P2] Knowledge base upload UX` (`t_design_knowledge_ux`)
**Feeds:** `[P1] Knowledge base ingestion UI` (`t_eng_knowledge_ingestion`)
**Owner:** design
**Status:** ready for eng review
**File:** `docs/design/index.html` (all 6 frames)

---

## 1. What changed in the design

The existing `app/knowledge/page.tsx` is a flat list with a textarea "Add Document" form. The new design replaces that with a full document lifecycle: drop, progress, ready, failed, delete, detail. Key moves:

- **Drop zone as the page hero**, not a tiny button. This is the primary action; it should look like one.
- **Real status states** for `queued`, `uploading`, `processing`, `ready`, `failed` — with distinct visual treatment, not just colored dots.
- **Soft-confirm delete modal** that names the document and tells the user what their customers will and won't see.
- **Document detail view** with chunk count, token estimate, last-tested, and source URL (if URL import).
- **Health signals** in the list (`stale` warning when a doc hasn't been updated in 14+ days, `never tested` for unvalidated docs).

The current file can be incrementally rebuilt — drop the `Add Document` form, keep the data fetcher, add the queue component, add the modal, add the detail page. The `useRealtime` hook on the existing page already covers the realtime updates we need.

---

## 2. Aesthetic direction

**"Linen"** — editorial / refined / warm. We deliberately do not use the default Tailwind blue/green/red scheme.

- Warm off-white (`#FAF8F4`) page; pure white cards on a 1px linen border.
- **Fraunces** (variable serif) for display — page titles, modal headlines, doc titles.
- **IBM Plex Sans** for body and UI — a step away from the usual Inter/Roboto.
- **IBM Plex Mono** for numerics and code (chunk counts, token estimates, log excerpts).
- Tinted status colors (forest, ochre, terracotta) — never bright red/green.
- Hairline borders, no heavy shadows. Cards sit on the page, not float over it.

This is intentionally different from the existing all-blue Tailwind page. If eng needs a closer visual match to the rest of InboxPilot, swap the accent to blue and the page still works — but the spec recommends staying warm.

---

## 3. Asset list

### Type

| Role            | Family               | Weight | Size  | Line height | Letter spacing |
|-----------------|----------------------|--------|-------|-------------|----------------|
| Page title (h1) | Fraunces             | 500    | 32 px | 1.10        | -0.015 em      |
| Modal headline   | Fraunces             | 500    | 22 px | 1.20        | 0              |
| Doc title        | Fraunces             | 500    | 28 px | 1.15        | 0              |
| Section heading | Fraunces             | 500    | 16 px | 1.30        | 0              |
| Body             | IBM Plex Sans        | 400    | 14 px | 1.50        | 0              |
| Body (dense)     | IBM Plex Sans        | 400    | 13 px | 1.50        | 0              |
| Label / caption  | IBM Plex Sans        | 500    | 11 px | 1.00        | 0.05 em (upper)|
| Numeric          | IBM Plex Mono        | 400    | 12 px | 1.50        | 0              |
| Eyebrow          | IBM Plex Mono        | 400    | 11 px | 1.00        | 0.08 em (upper)|
| Code / log       | IBM Plex Mono        | 400    | 12 px | 1.50        | 0              |

Load via Google Fonts: `Fraunces` (variable, opsz 9..144), `IBM Plex Sans` (400/500/600), `IBM Plex Mono` (400/500).

### Color

| Token         | Hex       | Use                              |
|---------------|-----------|----------------------------------|
| `--bg`        | `#FAF8F4` | Page background                  |
| `--surface`   | `#FFFFFF` | Cards, modal, table              |
| `--surface-2` | `#F4F0E6` | Subtle tint, topbar bg           |
| `--ink`       | `#1A1815` | Primary text                     |
| `--ink-2`     | `#6B655C` | Secondary text                   |
| `--ink-3`     | `#9A9386` | Tertiary / placeholder / meta    |
| `--line`      | `#E8E2D6` | Hairlines                        |
| `--line-2`    | `#D7CFBE` | Stronger borders                 |
| `--teal`      | `#0E5E5E` | Primary accent / focus           |
| `--teal-2`    | `#0A4848` | Primary hover                    |
| `--teal-soft` | `#E4EEEE` | Primary tint (tag bg)            |
| `--forest`    | `#4A7C3F` | Ready status                     |
| `--forest-bg` | `#EEF3E8` | (reserved)                       |
| `--ochre`     | `#B8761E` | Processing / stale               |
| `--ochre-bg`  | `#F6ECDC` | Processing tint                  |
| `--terra`     | `#A8331F` | Failed / destructive             |
| `--terra-bg`  | `#F5E2DC` | Failed tint                      |
| `--slate`     | `#6B655C` | Queued / inactive                 |
| `--slate-bg`  | `#EFEBE0` | Queued tint                       |

Type tags:

| Tag          | Background         | Text          |
|--------------|--------------------|---------------|
| FAQ          | `--teal-soft`      | `--teal`      |
| Article      | `--surface-2`      | `--ink-2`     |
| Policy       | `--ochre-bg`       | `--ochre`     |
| Manual       | `#ECE4F2`          | `#5C4475`     |
| Other        | `--slate-bg`       | `--ink-2`     |

### Icons (line, 1.5–1.8 stroke)

Hand-built SVG, no icon font. All 14×14 or 16×16, color `currentColor`.

| Where used        | Glyph                                       |
|-------------------|---------------------------------------------|
| Drop zone (idle)  | upload cloud / arrow up into tray            |
| Drop zone (hover) | check                                        |
| Drop zone (error) | circle with i                                |
| File (generic)    | document with folded corner                  |
| URL import        | chain link                                   |
| Failed alert      | triangle with !                              |
| Back link         | chevron-left                                 |
| Cancel / remove   | x-mark                                       |

### Spacing

4 / 8 / 12 / 16 / 24 / 32 / 40 / 56 / 64. The page header sits at 40 px horizontal padding; the queue, list, and detail views follow the same gutter.

### Radius

- Page chrome: 10 px
- Cards / queue / modal: 10 px
- Inputs: 6 px
- Pills, tags, status dots: 4 px (square) or 50% (round)

### Motion

- Status dot pulse: 1.4 s ease-in-out infinite
- Indeterminate progress: 1.6 s linear slide
- Drop zone hover transition: 200 ms ease-out
- No bouncy easings. No staggered reveals on this page.

---

## 4. Copy table (verbatim)

All copy is final. Do not rewrite, do not "improve". This is what the eng build ships.

### Page header

| Field          | Copy                                                                          |
|----------------|-------------------------------------------------------------------------------|
| Eyebrow        | Knowledge                                                                     |
| Title          | Documents the AI can read from                                               |
| Subtitle       | Drop in FAQs, policies, and product docs. We chunk, embed, and index them so the AI can quote them in replies. Updates go live the moment a document is ready. |

### Frame 1 — Drop zone

| State    | Headline                              | Body                                                                                  |
|----------|----------------------------------------|---------------------------------------------------------------------------------------|
| Default  | Drop files here, or click to browse    | Add to the AI's reading list. You can upload more than one at a time.                |
| Hover    | Release to add                         | We'll queue them, extract the text, and start indexing.                             |
| Invalid  | We can't read that file type           | `<filename.ext>` isn't a text document, so there's nothing for the AI to learn from. Try a PDF, Markdown, HTML, DOCX, or TXT file. |
| Tip      | (footnote)                             | Tip — a 30-page PDF typically takes about 15 seconds to index. Long manuals may take longer. |

Spec row: `PDF, Markdown, HTML, DOCX, TXT` · `up to 25 MB per file` · `50 docs / org`

### Frame 2 — Queue

| State       | Status label  | Helper text              |
|-------------|---------------|--------------------------|
| Queued      | Queued        | Waiting for a worker…    |
| Uploading   | Uploading     | `<pct>%` · `<sent> MB / <total> MB` |
| Processing  | Processing    | Extracting text and chunking… |

Action on every row: `Cancel` (link).

Queue header: `Indexing` (left) · `<done> of <total>` (right).

### Frame 3 — List

Column headers: `Document` · `Type` · `Status` · `Chunks` · `Last tested` · `Updated` · (actions)

Row actions: `Open` · `Delete`.

Stale caption: `Stale · 14 days since doc update` (ochre).

Last tested values: relative time (`2 hours ago`, `Yesterday`, `5 days ago`, `1 week ago`) or `Never`.

### Frame 4 — Failed

Standalone callout:
> **`<filename>`**
> Couldn't extract text — this PDF looks like a scanned image. OCR isn't enabled on your plan.
> [Retry indexing] [View server log ↗] [Remove from queue]

Inline expanded (mono, fenced):
> `ERROR  pdf_parse: no extractable text (page rasterization detected, no text layer)`
> `HINT   this file appears to be a scanned image; enable OCR or re-export with a text layer`
> `JOB    9c41e2a4-…-f3  duration 8.2s  model text-embedding-3-small`

Right rail: `FAILED 12:04` / `attempt 1 of 3`.

### Frame 5 — Delete modal

Title: **Delete *Return policy.pdf*?**
Body: This removes the document and its cached embeddings from the knowledge base. The AI will stop referencing it on the next message it sends.
Body: The action is logged for your audit trail and can't be undone from here. If you want it back, you'll need to re-upload the file.
Footnote: Customers won't see anything change until the AI's next reply.
Footer: `Cancel` (link) · `Delete document` (terra button).

### Frame 6 — Detail

Page title: doc title.
Crumbs: `Knowledge · <type> · <title>`.
Meta pills: `Status: <Ready|…>` · `Type: <type>` · `Updated <relative>` · `By <email>`.

Body section heading: `Body`.
Body preview is the first ~200 px of the document body, fade-to-bg at the bottom.

Test history heading: `Test history`.
Each entry: `<when>` line, `<what>` line. Passed entries have a forest dot.

Sidebar `Stats` block: `Chunks` · `Token estimate` · `Last tested` · `Last update` · `Source` · `Source URL`.
Sidebar `Manage` block: `Re-index` · `Download original` · `Delete document` (terra outline).

---

## 5. State machine (eng)

```
            ┌─────────┐
   drop ──▶ │ queued  │ ──┐
            └─────────┘   │
                │         │ cancel
                ▼         ▼
            ┌──────────┐  (removed)
            │uploading │
            └──────────┘
                │ bytes complete
                ▼
            ┌────────────┐
            │ processing │
            └────────────┘
           /              \
          ▼                ▼
     ┌────────┐       ┌────────┐
     │ ready  │       │ failed │
     └────────┘       └────────┘
        │                  │
        │ delete           │ retry (max 3) ──▶ queued
        ▼                  ▼
     (removed)         (removed)
```

Polling cadence:
- 2 s while any doc is in `queued`, `uploading`, or `processing`.
- Realtime (`useRealtime` already exists) once queue is empty.
- Failed docs continue to be polled at 10 s for retry eligibility.

Retry policy:
- Auto-retry up to 3× on transient errors (network, rate limit, server 5xx).
- Manual click required beyond that, or on permanent errors (parse, validation).

---

## 6. Component breakdown (eng)

Reuse the existing `useAuth` and `useRealtime` hooks. New components:

| Component             | Path suggestion                          | Notes |
|-----------------------|-------------------------------------------|-------|
| `DropZone`            | `components/knowledge/DropZone.tsx`       | Default + hover + invalid. Use `<input type="file" multiple>` underneath. |
| `UploadQueue`         | `components/knowledge/UploadQueue.tsx`    | Lives at the top of the page while queue &gt; 0. |
| `QueueRow`            | `components/knowledge/QueueRow.tsx`       | One row, three states. |
| `DocumentList`        | `components/knowledge/DocumentList.tsx`   | Table, ready state. |
| `FailedCallout`       | `components/knowledge/FailedCallout.tsx`  | Standalone, above the list. |
| `FailedRow`           | `components/knowledge/FailedRow.tsx`      | Inline expanded view. |
| `DeleteConfirmModal`  | `components/knowledge/DeleteConfirmModal.tsx` | Soft confirm. Esc/Enter bound. |
| `DocumentDetail`      | `app/knowledge/[id]/page.tsx`             | Sidebar + main. |
| `TestHistory`         | `components/knowledge/TestHistory.tsx`     | Timeline list. |

The current `app/knowledge/page.tsx` keeps the existing data fetch + realtime hook; just replace the JSX with the new components.

---

## 7. Accessibility checklist

- Drop zone: `role="button"` with keyboard activation (Enter / Space) and a hidden file input. `aria-label="Upload documents"`.
- Drag events: also fire on click; never require drag-and-drop as the only path.
- Status changes: announce via `aria-live="polite"` on the queue region. `role="status"` on toasts.
- Failed state: `role="alert"` for the error reason. The "view server log" link gets `rel="noopener"` and `target="_blank"`.
- Modal: `role="dialog"`, `aria-modal="true"`, focus trap, return focus to the trigger on close. Esc closes.
- Delete button: `aria-label="Delete Return policy"` (full title, not just "Delete").
- Color is never the only signal — every status has a label.

---

## 8. Open questions for eng

1. **File picker** — do we also accept a paste-from-clipboard (image, text)? It's a 4-line addition; flag if it's wanted.
2. **Token estimate** — exact computation or `chars / 4` approximation? The frame shows `~18,400` for a 142-chunk doc; the eng team should decide whether to call the embeddings API for an exact number.
3. **Re-index** — does re-indexing preserve `chunks` (in-place) or blow them away and re-derive? Affects whether the "chunks" column flickers during re-index.
4. **Stale threshold** — currently 14 days. The eng team should confirm this against the doc-update cadence in the data model.
5. **URL import** — there's a `source_type: 'url'` somewhere in the future; the detail view reserves a `Source URL` field. Frame 06 shows it as a dash for file uploads; eng should confirm the column actually exists in `knowledge_documents`.

None of these block the visual handoff. Frame the answers as decisions in the eng task card; I'll pick up any design deltas.

---

## 9. Files delivered

- `docs/design/index.html` — all 6 frames in one self-contained HTML file. Open in a browser; no build step.
- `docs/design/spec.md` — this document.

No Figma file is produced (we don't have a Figma seat in this environment). The HTML renders pixel-faithful to the intended Figma file: same copy, same hierarchy, same tokens. Eng can build directly from `index.html` and `spec.md`.
