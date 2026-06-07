# Inbox UI states — design hand-off

**Card:** `[P1] Inbox UI states (empty, loading, error, escalated lane, AI-draft pending)` (`t_design_inbox_states`)
**Feeds:** `[P1] Inbox UI end-to-end` (`t_eng_inbox_ui`)
**Owner:** design
**Status:** ready for eng review
**Files:**
- `docs/design/inbox-states.html` — all 20 frames in one self-contained HTML file. Open in a browser; no build step.
- `docs/design/inbox-states.md` — this document.

---

## 1. Reader, goal, and the 8-hour contract

A support agent lives in the inbox for **eight hours a day**. Every state on every component is something they'll see dozens of times a session. That changes the design calculus: states that look "fine" on a Figma slide look *exhausting* by hour three. Every state is graded on three questions:

1. **Does the agent know what to do next, in under 1 second, with peripheral vision?**
2. **Is the work preserved when something goes wrong?**
3. **Does the state feel like part of the same product, or does it look like a placeholder?**

The current components (`components/inbox/*`) cover the happy path well and treat the other states as afterthoughts: a spinner and a red box. The new spec replaces those afterthoughts with intentional states that respect the agent's time, the agent's work, and the agent's attention.

## 2. What changed in the design

| Component | Old states | New states (frame IDs) |
|---|---|---|
| `ConversationList` | spinner + "No conversations yet" red box | **CL-1** loading (skeleton) · **CL-2** error (cached list + retry) · **CL-3** empty (friendly, time-bound copy) · **CL-4** populated (hover/focus/selected/escalated) |
| `MessageThread` | spinner + red box | **MT-1** loading (alternating skeleton bubbles) · **MT-2** empty (new convo) · **MT-3** error (draft preserved notice) · **MT-4** success (AI bubble style) |
| `AiDraftPanel` | one blue spinner for everything | **AI-1** thinking (skeleton + elapsed, no spinner) · **AI-2** drafted (confidence + actions) · **AI-3** escalated (human handoff, not error) · **AI-4** failed (retry/write/report) · **AI-5** loading (fetching draft) · **AI-6** idle (shortcut hint) |
| `ReplyComposer` | textarea + disabled send | **RC-1** idle focused with draft · **RC-2** idle empty · **RC-3** sending · **RC-4** success (Resolve CTA) · **RC-5** error (draft preserved + retry counter) · **RC-6** disabled (AI auto-replying) |
| `StatusBadge` | 4 status colors only | **SB-1** full status set + AI state set + paired states + hover/focus |

Plus the two cross-cutting decisions:

- **The Escalated lane** — a filter chip on the rail, not a separate column. See §3.
- **Keyboard shortcuts** — a single focus zone, scoped to the inbox page. See §7.

## 3. Aesthetic direction

**"Linen Operations"** — same family as the knowledge-base page (`docs/design/spec.md`, `docs/design/index.html`) and the analytics dashboard (`docs/design/analytics.{html,md}`). Intentionally not the default Tailwind blue/green/red scheme.

- Warm off-white page (`#FAF8F4`), pure white cards on a 1&nbsp;px linen border.
- **Fraunces** for display (page title, section headings, empty-state headlines).
- **IBM Plex Sans** for body, button labels, badge labels.
- **IBM Plex Mono** for the AI thinking elapsed timer, channel labels, shortcut keys, confidence numbers, SLA countdowns, error codes, CSV-style action labels.
- Tinted status colors (forest / ochre / terracotta) — never bright red/green, never on a colored fill, only on borders, badge outlines, sparkline strokes, and pulse dots.
- Hairline borders, no heavy shadows. The thread, the rail, the composer all sit on the page, not float over it.

The difference from the editorial knowledge-base page and the information-dense analytics page: **the inbox is the operational surface**. The visual language is the same but the rhythm is denser, the borders are 1&nbsp;px (not 2&nbsp;px), and the monospace use is heavier (elapsed time, SLA countdowns, character counts) because the agent is reading small numeric signals while typing.

## 4. The Escalated lane — decision

The escalated conversation is the most expensive thing on the screen. It costs SLA time, it costs a human's attention, and it's the single most likely place a customer is going to leave. Three decisions:

1. **Filter chip, not a dedicated column.** Agents need the full conversation list to triage; a dedicated column would force them to context-switch. The chip lives at the top of `ConversationList`, on the same row as All/Open/Pending/Resolved, with a terra dot and terra text in the inactive state and a terra background fill in the active state.

2. **Sort by `escalated_at DESC`, not `last_message_at DESC`, when the chip is active.** The most recent escalation floats to the top, even if the customer replied minutes later. The agent's mental model is "oldest escalation = highest risk", which is the opposite of the normal inbox.

3. **SLA countdown on every escalated item**, in mono, in `--ink-3` until under 15 minutes, then in `--terra`. The number is a timer, not a label. It gives the agent a peripheral sense of "how long do I have" without forcing a click.

The badge label stays **"Escalated"** (not "Urgent" — the word is louder than the action, and the agent should treat escalation as *do it now*, not *panic*). The chip count is in mono so the eye learns the rhythm. There is no terra on a colored fill anywhere in the rail — terra is for attention, not wallpaper.

See frames **ESC-1a** (inactive), **ESC-1b** (active, list sorted by escalation), **ESC-1c** (empty / queue clear).

## 5. AI-draft pending — decision

The existing component shows a spinner with "AI is analyzing the conversation…". That's wrong for two reasons. First, a spinner implies a known duration, and the agent can't tell whether to wait or start typing. Second, after 30 seconds of spinner, the agent gives up on the AI and writes the reply manually — at which point the AI's late draft collides with the human's draft.

The new design:

- **Three skeleton lines** (92% / 78% / 64% width) animating with a left-to-right shimmer. After 5 seconds, the panel collapses to a single line. The eye learns the rhythm and forgets about it.
- **Elapsed-time label** in mono, updating every 1 second, in `--ink-3`. Format `M:SS` under a minute, `H:MM:SS` after. After 30s the label switches to `--ochre`; after 60s to `--terra` with a "stuck? regenerate" inline action.
- **No spinner anywhere on the AI panel.** Spinners are for known durations (the "Sending…" state on `ReplyComposer` is fine because we know the request is in flight and bounded by the network timeout). AI thinking is open-ended; a spinner is a lie.
- **Confidence is always shown**, never hidden. The chip uses an outline, not a fill, in forest (75-100%), ochre (50-74%), or terra (0-49%). The agent learns to glance at the number before approving.
- **The "Approve" button is "Approve &amp; send"** — verb + delivery confirmation, not just a verb. Sending is destructive (it goes to the customer) and the button should remind the agent of that.
- **The panel teaches the agent a shortcut** when idle: "press Shift+R to ask the AI to draft". This is the only state where the panel can render nothing — but if we render the hint, we teach the shortcut.

See frames **AI-1** through **AI-6**.

## 6. Token reuse

The inbox spec reuses the same token names and hex values as the knowledge-base and analytics specs. **No new tokens are introduced.** If eng needs per-tenant color overrides, do it via a single CSS variable override on `<body data-tenant="…">` — don't fork the palette.

| Token | Hex | Use in inbox |
|---|---|---|
| `--bg` | `#FAF8F4` | Inbox page background, thread canvas |
| `--surface` | `#FFFFFF` | Rail background, message bubbles, composer, AI panel |
| `--surface-2` | `#F4F0E6` | Subtle tint, filter strip, focused composer |
| `--surface-3` | `#FBF7EC` | Search input bg, hover row, thinking state bg |
| `--ink` | `#1A1815` | Primary text, focus ring on dark, Resolve button |
| `--ink-2` | `#6B655C` | Secondary text, badge labels, empty-state body |
| `--ink-3` | `#9A9386` | Tertiary — "Last saved 2s ago", elapsed timer, char count |
| `--line` | `#E8E2D6` | Hairlines between rail items, panel borders |
| `--line-2` | `#D7CFBE` | Stronger borders, button borders, focus rings |
| `--teal` | `#0E5E5E` | Primary accent — focus ring, agent message bubble, AI panel border |
| `--teal-2` | `#0A4848` | Primary hover |
| `--teal-soft` | `#E4EEEE` | AI panel bg, selected rail item, EMAIL chip |
| `--forest` | `#4A7C3F` | Healthy — Open badge, success composer, "Sent" check |
| `--forest-bg` | `#EEF3E8` | Healthy fill — success composer bg |
| `--ochre` | `#B8761E` | Watch — Pending badge, 30s+ elapsed timer |
| `--ochre-bg` | `#F6ECDC` | Watch fill |
| `--terra` | `#A8331F` | Action — Escalated badge, escalated lane, error borders, failed AI |
| `--terra-bg` | `#F5E2DC` | Action fill — error box bg, escalated AI panel bg |
| `--slate` | `#6B655C` | Flat / inactive — Resolved badge, disabled composer |
| `--slate-bg` | `#EFEBE0` | Flat fill |

## 7. Type

| Role | Family | Weight | Size | Line height | Letter spacing |
|---|---|---|---|---|---|
| Page title (h1) | Fraunces | 500 | 40 px | 1.05 | -0.02 em |
| Section heading | Fraunces | 500 | 26 px | 1.15 | -0.01 em |
| Empty-state headline | Fraunces | 500 | 15-16 px | 1.30 | 0 |
| Thread title (h2) | Fraunces | 500 | 17 px | 1.20 | 0 |
| Eyebrow | IBM Plex Mono | 500 | 11 px | 1.00 | 0.08 em (uppercase) |
| Filter chip | IBM Plex Sans | 500 | 11.5 px | 1.00 | 0 |
| Rail item name | IBM Plex Sans | 500 | 13 px | 1.30 | 0 |
| Rail item subject | IBM Plex Sans | 400 | 12 px | 1.30 | 0 |
| Rail item time | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| Status badge | IBM Plex Sans | 500 | 11 px | 1.00 | 0 |
| AI state badge | IBM Plex Sans | 500 | 11 px | 1.00 | 0 |
| AI confidence | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| AI elapsed timer | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| SLA countdown | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| Message bubble | IBM Plex Sans | 400 | 13 px | 1.50 | 0 |
| Composer input | IBM Plex Sans | 400 | 13 px | 1.45 | 0 |
| Send button | IBM Plex Sans | 500 | 12.5 px | 1.00 | 0 |
| Send button kbd hint | IBM Plex Mono | 400 | 10 px | 1.00 | 0 |
| Char count | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| Error message | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |
| Error code | IBM Plex Mono | 400 | 10.5 px | 1.00 | 0 |

Load via Google Fonts: `Fraunces` (variable, opsz 9..144), `IBM Plex Sans` (400/500/600), `IBM Plex Mono` (400/500).

## 8. Keyboard shortcuts

| Shortcut | Action | Scope | Notes |
|---|---|---|---|
| `J` / `K` | Next / prev conversation | inbox · list focused | Wraps at the ends. Same handler as `↑` / `↓` for muscle memory. |
| `↑` / `↓` | Next / prev conversation | inbox · list focused | Same as J/K. |
| `R` | Focus reply composer | inbox · thread focused | Caret placed at end of existing draft or empty position. |
| `Shift`+`R` | Ask AI to draft a reply | inbox · thread focused | Triggers AI draft even when a draft exists. Previous draft preserved as version. |
| `⌘ ⏎` / `Ctrl ⏎` | Send reply | composer focused | Disabled when composer is empty or already sending. |
| `⇧ ⏎` | Newline in composer | composer focused | Default textarea behavior. Never sends. |
| `E` | Escalate | inbox · thread focused | Prompts for one-line reason, then sets `status = escalated` and notifies the team channel. Confirm step if conversation is already resolved. |
| `S` | Resolve | inbox · thread focused | Sets `status = resolved`, archives from default rail. Auto-reply only if AI is in `auto_reply` mode and the org has it enabled. |
| `Esc` | Leave current focus zone | any | Composer → thread → list → page header. Never closes the page. |
| `/` | Focus search | inbox | Slashes into the search input; Esc returns focus to the list. |
| `?` | Show shortcuts help | inbox | Focus-trapped modal. Closes on Esc or any other key. |
| `1`–`5` | Switch filter chip | inbox · list focused | 1=All, 2=Open, 3=Pending, 4=Escalated, 5=Resolved. Mirrors chip order. |

### Why scoped, not global

The shortcuts are attached to the inbox page via a single `useInboxShortcuts` hook, not at the document level. This prevents stealing keystrokes from:
- Modal dialogs (delete confirmations, the `?` help overlay)
- The composer (typing letters should never trigger navigation)
- Other pages (the analytics page should not have J/K navigating conversations)
- Browser shortcuts (`?` is not a browser shortcut, but `R` and `E` could conflict with future extensions)

The scoping also makes the shortcuts testable: a single hook with a single set of `keydown` listeners that the inbox page mounts and unmounts. See frame **KBD-1** for the `?` overlay treatment.

## 9. Accessibility checklist (per Web Interface Guidelines)

Every state in this spec passes:

- **Color is not the only signal.** Badges include both a colored dot and a text label. The escalated state uses both a terra left border and a terra badge. Errors include a text message, not just a red background.
- **Focus is always visible.** All interactive elements have a 2&nbsp;px teal outline (or 2&nbsp;px teal left border on the rail item) at 1&nbsp;px offset. Never a focus style that depends on hover.
- **Disabled controls are obviously disabled.** Lower opacity, no shadow, `cursor: not-allowed`, and a text explanation ("AI is drafting — composer will unlock in a moment").
- **Live regions are polite.** The thread uses `aria-live="polite"` so new messages don't interrupt the agent. The AI panel uses `role="status"` for the thinking state and `role="alert"` for the escalated and failed states.
- **Keyboard alternatives exist for every action.** All chip filters have number keys. The escalated lane has a chip, not just a sort. The error states always have a primary action button as a focus target.
- **Touch targets are ≥ 44×44 px.** Every rail item, every chip, every button meets the minimum.

## 10. Eng hand-off — frame map

| Frame ID | Component | State | File location |
|---|---|---|---|
| ESC-1a | ConversationList | Escalated chip · inactive | inbox-states.html §1 |
| ESC-1b | ConversationList | Escalated chip · active (filter on) | inbox-states.html §1 |
| ESC-1c | ConversationList | Escalated · empty state | inbox-states.html §1 |
| CL-1 | ConversationList | Loading (skeleton) | inbox-states.html §2 |
| CL-2 | ConversationList | Error (with cached list) | inbox-states.html §2 |
| CL-3 | ConversationList | Empty (no conversations) | inbox-states.html §2 |
| CL-4 | ConversationList | Populated · hover / focus / selected | inbox-states.html §2 |
| MT-1 | MessageThread | Loading (alternating skeleton bubbles) | inbox-states.html §3 |
| MT-2 | MessageThread | Empty (new conversation) | inbox-states.html §3 |
| MT-3 | MessageThread | Error (draft preserved) | inbox-states.html §3 |
| MT-4 | MessageThread | Success · with AI bubble | inbox-states.html §3 |
| AI-1 | AiDraftPanel | Thinking (skeleton + elapsed) | inbox-states.html §4 |
| AI-2 | AiDraftPanel | Drafted (confidence + actions) | inbox-states.html §4 |
| AI-3 | AiDraftPanel | Escalated (human handoff) | inbox-states.html §4 |
| AI-4 | AiDraftPanel | Failed (retry / write / report) | inbox-states.html §4 |
| AI-5 | AiDraftPanel | Loading (fetching the draft) | inbox-states.html §4 |
| AI-6 | AiDraftPanel | Empty / idle (shortcut hint) | inbox-states.html §4 |
| RC-1 | ReplyComposer | Idle · focused with draft | inbox-states.html §5 |
| RC-2 | ReplyComposer | Idle · empty | inbox-states.html §5 |
| RC-3 | ReplyComposer | Sending | inbox-states.html §5 |
| RC-4 | ReplyComposer | Success (Resolve CTA) | inbox-states.html §5 |
| RC-5 | ReplyComposer | Error (network) — draft preserved | inbox-states.html §5 |
| RC-6 | ReplyComposer | Disabled (AI auto-replying) | inbox-states.html §5 |
| SB-1 | StatusBadge | All badge states (status + AI + paired + focus) | inbox-states.html §6 |
| KBD-1 | Shortcuts | `?` overlay (in-app help) | inbox-states.html §7 |

**Component count:** 5 components × 4-6 states each = **25 mock states** in 1 file. (Acceptance criteria asks for 5×4=20; we delivered 25 with the extra states being the escalated lane (3 frames), the AI loading vs thinking distinction, the composer disabled state, the success state, and the badge focus state — each a real state the agent will see.)

Breakdown: ESC-1a/b/c (3) + CL-1/2/3/4 (4) + MT-1/2/3/4 (4) + AI-1/2/3/4/5/6 (6) + RC-1/2/3/4/5/6 (6) + SB-1 (1) + KBD-1 (1) = 25.

## 11. What this hand-off is not

This is not a Figma file. It's a self-contained HTML document with annotated frames and a spec attached. Eng should be able to take any frame ID (e.g. `AI-1`) and find the exact pixel treatment for that state in `inbox-states.html`. If a frame needs to change, the change lives in the HTML first, then in code — the design file is the source of truth for visual decisions, and the spec doc is the source of truth for the *why* behind each decision.

The HTML file is also the test target. When eng ships the new components, they should render the file in a side-by-side comparison and the result should be visually identical to within 1&nbsp;px of rendering differences (font hinting, subpixel rounding).

---

**Owner:** design
**Status:** ready for eng review
**Next card:** `[P1] Inbox UI end-to-end` (`t_eng_inbox_ui`) — feeds off this hand-off.
