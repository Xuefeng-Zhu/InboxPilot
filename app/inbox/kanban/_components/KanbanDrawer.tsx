'use client';

/**
 * KanbanDrawer — slide-over panel for /inbox/kanban (T11).
 *
 * Wraps the existing <RightPanel conversationId={…} /> in its inline
 * mode (the project-wide detail panel: ContactDetails + ActivityPanel)
 * inside a fixed-position drawer. The kanban always uses the drawer
 * mode; there is no inline "right column" because the 5-lane grid
 * fills the viewport.
 *
 * Reuse decision: do NOT re-implement MessageThread + AiDraftPanel
 * inline. RightPanel already has both, plus the loading state, the
 * realtime wiring, and the channel-aware "Send reply" composer. This
 * file is pure chrome — backdrop + panel + close button + the
 * <RightPanel> child.
 *
 * RightPanel's ESC keydown handler (RightPanel.tsx:52-59) is dormant
 * here: the useEffect early-returns when `open` is `undefined`, which
 * is the state we render (we pass no `open` prop). So the document-
 * level keydown listener never binds, and the kanban gets no keyboard
 * close. That matches v1's "no keyboard in the kanban" scope.
 *
 * The wrapper div around <RightPanel> uses the Tailwind arbitrary
 * variant `[&>aside]:!…` to override the aside's responsive
 * `hidden … xl:block` and its fixed `w-right-panel-w` (320px) so the
 * aside fills the drawer panel at every viewport. The aside's own
 * inner `<div className="h-full overflow-y-auto">` keeps its scroll
 * behavior; the panel's `overflow-y-auto` is a defensive fallback.
 */

import { RightPanel } from '@/components/inbox/RightPanel';

interface KanbanDrawerProps {
  conversationId: string | null;
  onClose: () => void;
  isOpen: boolean;
}

export function KanbanDrawer({
  conversationId,
  isOpen,
  onClose,
}: KanbanDrawerProps) {
  if (!isOpen || !conversationId) return null;

  return (
    <>
      <div
        data-testid="drawer-backdrop"
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-testid="kanban-drawer"
        className="fixed top-0 right-0 z-50 h-full w-full overflow-y-auto bg-white shadow-level-3 sm:w-[480px]"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation details"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute right-3 top-3 z-10 rounded p-1 text-[var(--m03-fg-3)] transition-colors hover:bg-[var(--m03-line-2)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
        <div className="h-full [&>aside]:!block [&>aside]:!h-full [&>aside]:!w-full [&>aside]:!border-0">
          <RightPanel conversationId={conversationId} />
        </div>
      </div>
    </>
  );
}
