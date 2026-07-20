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
 * The wrapper div around <RightPanel> uses the Tailwind arbitrary
 * variant `[&>aside]:!…` to override the aside's responsive
 * `hidden … xl:block` and its fixed `w-right-panel-w` (320px) so the
 * aside fills the drawer panel at every viewport. The aside's own
 * inner `<div className="h-full overflow-y-auto">` keeps its scroll
 * behavior; the panel's `overflow-y-auto` is a defensive fallback.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RightPanel } from '@/components/inbox/RightPanel';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = document.createElement('div');
    element.dataset.kanbanDrawerPortal = '';
    document.body.appendChild(element);
    setPortalElement(element);
    return () => element.remove();
  }, []);

  useEffect(() => {
    if (!isOpen || !conversationId || !portalElement) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const backgroundState = Array.from(document.body.children)
      .filter((element) => element !== portalElement)
      .map((element) => ({
        element,
        ariaHidden: element.getAttribute('aria-hidden'),
        hadInert: element.hasAttribute('inert'),
      }));
    for (const { element } of backgroundState) {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      for (const { element, ariaHidden, hadInert } of backgroundState) {
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
        if (!hadInert) element.removeAttribute('inert');
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [conversationId, isOpen, onClose, portalElement]);

  if (!isOpen || !conversationId || !portalElement) return null;

  return createPortal(
    <>
      <div
        data-testid="drawer-backdrop"
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="kanban-drawer"
        className="fixed top-0 right-0 z-50 h-full w-full overflow-y-auto bg-white shadow-level-3 sm:w-[480px]"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation details"
      >
        <button
          ref={closeButtonRef}
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
    </>,
    portalElement,
  );
}
