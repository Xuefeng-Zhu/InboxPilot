'use client';

import { useEffect, useRef } from 'react';
import { RiverCard, type RiverCardData } from './RiverCard';

interface RiverProps {
  cards: RiverCardData[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onApproved?: (id: string) => void;
}

/**
 * River — horizontal scrollable strip of conversation cards. When the active
 * id changes, scrolls the active card into view.
 */
export function River({ cards, activeId, onSelect, onApproved }: RiverProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (!activeId) return;
    const el = cardRefs.current.get(activeId);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    // jsdom does not implement scrollBy; guard so tests don't blow up.
    if (typeof scroller.scrollBy !== 'function') return;
    // Center the active card within the scroller
    const scrollerRect = scroller.getBoundingClientRect();
    const cardRect = el.getBoundingClientRect();
    const offset =
      cardRect.left - scrollerRect.left - (scrollerRect.width - cardRect.width) / 2;
    scroller.scrollBy({ left: offset, behavior: 'smooth' });
  }, [activeId]);

  if (cards.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center"
        data-testid="river-empty"
      >
        <p className="font-mono text-[12px] text-[var(--m03-fg-3)]">
          No conversations in this window.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6 pt-12"
      role="list"
      aria-label="Conversation river"
      data-testid="river"
    >
      <div className="flex items-center gap-3.5">
        {cards.map((card) => (
          <div
            key={card.id}
            role="listitem"
            ref={(el) => {
              if (el) cardRefs.current.set(card.id, el);
              else cardRefs.current.delete(card.id);
            }}
          >
            <RiverCard
              data={card}
              isActive={card.id === activeId}
              onSelect={onSelect}
              onApproved={onApproved}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
