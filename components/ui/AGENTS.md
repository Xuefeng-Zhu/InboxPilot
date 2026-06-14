# components/ui/ — Design System Primitives

**Always loaded** for any UI work — every screen, page, and feature uses these.

## OVERVIEW
10 shadcn-style primitive components. All re-exported through `index.ts`. Tokens defined as CSS custom properties in `app/globals.css` (the M03 monochrome system). Tailwind 3.4 (do NOT upgrade to v4).

## THE 10 PRIMITIVES (+ cn helper)
| Component | Purpose |
|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md' \| 'lg'`. |
| `Input` | Text input with label/error/hint slots. |
| `Select` | Dropdown with same slots as Input. |
| `Textarea` | Multi-line input. |
| `StatusBadge` | Conversation status pill. Also exports `AiStateIndicator` and `AiState` type. |
| `Tooltip` | Radix-based, with `<TooltipProvider>` at the app shell level. |
| `Card` | Generic container with header/body/footer slots. |
| `Chips` | `Pill`, `Tag`, and `PillTone` type. |
| `cn.ts` | `cn()` (clsx wrapper, design-system class joiner). |
| `index.ts` | Barrel — re-exports all of the above. |

## WHERE TO LOOK
- **Add a new primitive** → drop a new `<Name>.tsx` here, export it from `index.ts`, then consume via `import { Name } from '@/components/ui'`.
- **Change a token** → edit `app/globals.css` `:root` (the M03 monochrome tokens). Do NOT add hex values in `tailwind.config.ts` (it's intentionally empty of colors).
- **Override Tailwind spacing/radii/shadows** → `tailwind.config.ts` has the design tokens (`sidebar-w`, `inbox-list-w`, `right-panel-w`, custom radii, `level-2`/`level-3` shadows).

## CONVENTIONS
- **All primitives accept `className` and pass it to the root element** for one-off overrides.
- **All primitives are forward-ref compatible** (so `ref` works through them).
- **Tokens are CSS custom properties** — Tailwind config defers color/typography to `app/globals.css`. Components reference them as `text-[var(--m03-fg)]` etc.
- **Component file naming:** PascalCase, one component per file. Co-locate types if small (`StatusBadge.tsx` exports its own `AiState` type).
- **Radix-based primitives (`Tooltip`, `Select`) declare `'use client'`**. Other primitives (`Button`, `Input`, `Textarea`, `StatusBadge`, `Card`, `Chips`) are server-renderable.

## ANTI-PATTERNS
- Adding hex values to `tailwind.config.ts` (use CSS variables).
- Importing from `node_modules` for UI (no Radix Tooltip Wrapper from a lib; the project uses `@radix-ui/react-tooltip` directly).
- Adding a primitive that depends on a feature (primitives are pure UI atoms — no InsForge calls, no auth checks).
- Skipping the `index.ts` re-export (breaks the `@/components/ui` import path used everywhere).

## UNIQUE
- **Two `Topbar.tsx` files exist on purpose** — `components/Topbar.tsx` (landing, accepts `nav[]` + `cta` slot) vs `components/layout/Topbar.tsx` (in-app, with auth). This is intentional, not a duplicate.
- **`StatusBadge` doubles as the AI-state indicator** (it exports `AiStateIndicator` and `AiState` type).
- **`Tooltip` and `Select` use Radix** — the two components in the dir that pull a third-party UI primitive directly.
- **`Card` is generic** — no opinions about content, no padding variants, no shadow variants (use `shadow-level-2` / `shadow-level-3` from the Tailwind config).
