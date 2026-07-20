'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useOrgMembership } from '@/lib/queries';
import {
  useSymphonyConversations,
  useSymphonyCounts,
  computeSymphonyWindow,
  barToneForAiState,
  positionPct,
  type Zoom,
} from '@/lib/queries/hooks/useSymphony';
import { useRealtime } from '@/lib/use-realtime';
import { SymphonyControls } from './SymphonyControls';
import { TimeAxis } from './TimeAxis';
import { River } from './River';
import { MiniMap } from './MiniMap';
import type { RiverCardData } from './RiverCard';
import { AppShell } from '@/components/layout/AppShell';

interface SymphonyViewProps {
  initialZoom: Zoom;
}

export function SymphonyView({ initialZoom }: SymphonyViewProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: orgId } = useOrgMembership(user?.id);

  const [zoom, setZoom] = useState<Zoom>(initialZoom);
  const [step, setStep] = useState<number>(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [acceptedWarning, setAcceptedWarning] = useState<string | null>(null);

  const { data: conversations } = useSymphonyConversations(orgId ?? undefined, zoom, step);
  const { data: counts } = useSymphonyCounts(orgId ?? undefined, zoom, step);

  const windowInfo = useMemo(() => computeSymphonyWindow(zoom, step), [zoom, step]);

  useEffect(() => {
    setAcceptedWarning(null);
  }, [orgId]);

  // Default the active card to the most-recent conversation in the window
  useEffect(() => {
    if (!conversations || conversations.length === 0) {
      setActiveId(null);
      return;
    }
    if (activeId && conversations.some((c) => c.id === activeId)) {
      return; // keep current selection if still in window
    }
    const last = conversations[conversations.length - 1];
    setActiveId((last?.id as string) ?? null);
  }, [conversations, activeId]);

  // Realtime: invalidate symphony queries when something changes in this org
  useRealtime({
    messageChannel: orgId ? `org:${orgId}` : undefined,
    conversationChannel: orgId ? `org:${orgId}` : undefined,
    onNewMessage: () => {
      queryClient.invalidateQueries({ queryKey: ['symphony-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['symphony-counts'] });
    },
    onConversationUpdated: () => {
      queryClient.invalidateQueries({ queryKey: ['symphony-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['symphony-counts'] });
    },
  });

  // Map conversations to card data
  const cards: RiverCardData[] = useMemo(() => {
    return (conversations ?? []).map((c) => {
      const contact = (c.contacts ?? null) as { name?: string | null } | null;
      const name = contact?.name ?? 'Unknown';
      const latest = c.latest_message as { body?: string | null } | null | undefined;
      return {
        id: c.id,
        contactName: name,
        contactInitial: name.charAt(0).toUpperCase(),
        channel: c.channel,
        lastMessageAt: c.last_message_at,
        lastMessagePreview: latest?.body ?? '',
        aiState: c.ai_state,
        status: c.status,
      };
    });
  }, [conversations]);

  // Mini-map bars
  const bars = useMemo(() => {
    return (conversations ?? []).map((c) => ({
      conversationId: c.id,
      leftPct: positionPct(c.last_message_at, windowInfo.windowStart, windowInfo.windowEnd),
      tone: barToneForAiState(c.ai_state, c.status),
      isActive: c.id === activeId,
    }));
  }, [conversations, activeId, windowInfo.windowStart, windowInfo.windowEnd]);

  const autoReplied = (conversations ?? []).filter(
    (c) => c.ai_state === 'auto_replied',
  ).length;
  const awaitingYou = (conversations ?? []).filter(
    (c) => c.ai_state === 'drafted' || c.status === 'escalated',
  ).length;

  return (
    <AppShell noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--m03-bg)]">
        {/* Topbar stats (M03 inline; the global Topbar in AppShell still renders the brand+search) */}
        <div className="flex items-center gap-5 border-b border-[var(--m03-line)] bg-[var(--m03-bg)] px-6 py-0 h-14 font-mono text-[11px] text-[var(--m03-fg-2)]">
          <span>
            <strong className="mr-1 font-medium text-[var(--m03-fg)] tabular-nums">
              {counts?.stream ?? '—'}
            </strong>
            STREAM
          </span>
          <span>
            <strong className="mr-1 font-medium text-[var(--m03-green)] tabular-nums">
              {counts?.drafting ?? '—'}
            </strong>
            DRAFTING
          </span>
          <span>
            <strong className="mr-1 font-medium text-[var(--m03-fg)] tabular-nums">
              {counts?.escalated ?? '—'}
            </strong>
            ESCALATED
          </span>
        </div>

        {/* Controls bar */}
        <SymphonyControls
          zoom={zoom}
          step={step}
          onZoomChange={(z) => {
            setZoom(z);
            setStep(0); // switching zoom resets the step
          }}
          onStep={(delta) => setStep((s) => s + delta)}
          onReset={() => setStep(0)}
          conversationCount={cards.length}
        />

        {/* Time axis */}
        <TimeAxis zoom={zoom} step={step} />

        {acceptedWarning && (
          <div
            className="mx-6 mt-3 flex items-start gap-2 rounded border border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-3 py-2.5 text-[11px] text-[var(--m03-orange)]"
            role="alert"
          >
            <span className="flex-1">{acceptedWarning}</span>
            <button
              type="button"
              onClick={() => setAcceptedWarning(null)}
              className="shrink-0 font-semibold underline-offset-2 hover:underline"
              aria-label="Dismiss approval warning"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* The river */}
        <River
          cards={cards}
          activeId={activeId}
          onSelect={setActiveId}
          onAcceptedWarning={setAcceptedWarning}
          onApproved={(id) => {
            // After approval, the active card stays put but its pill flips
            // (handled by the query invalidation + River re-render).
            setActiveId(id);
          }}
        />

        {/* Mini-map */}
        <MiniMap
          bars={bars}
          windowStart={windowInfo.windowStart}
          windowEnd={windowInfo.windowEnd}
          totalInWindow={cards.length}
          autoRepliedCount={autoReplied}
          awaitingYouCount={awaitingYou}
          onBarClick={(id) => setActiveId(id)}
        />
      </div>
    </AppShell>
  );
}
