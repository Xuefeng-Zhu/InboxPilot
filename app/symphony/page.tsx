'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SymphonyView } from './_components/SymphonyView';
import { AppShell } from '@/components/layout/AppShell';
import type { Zoom } from '@/lib/queries/hooks/useSymphony';

const VALID_ZOOM: readonly Zoom[] = ['today', 'week', 'month', 'all'];

function parseZoom(raw: string | null): Zoom {
  if (raw && (VALID_ZOOM as readonly string[]).includes(raw)) {
    return raw as Zoom;
  }
  return 'week';
}

export default function SymphonyPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-[var(--m03-fg-2)]">Loading symphony…</p>
          </div>
        </AppShell>
      }
    >
      <SymphonyPageContent />
    </Suspense>
  );
}

function SymphonyPageContent() {
  const searchParams = useSearchParams();
  const initialZoom = parseZoom(searchParams.get('zoom'));
  return <SymphonyView initialZoom={initialZoom} />;
}
