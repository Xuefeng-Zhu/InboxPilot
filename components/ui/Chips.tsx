'use client';

import { cn } from './cn';

export type PillTone = 'default' | 'active' | 'red' | 'green' | 'orange';

export function Pill({
  active = false,
  tone = 'default',
  className,
  children,
}: {
  active?: boolean;
  tone?: PillTone;
  className?: string;
  children: React.ReactNode;
}) {
  const toneClass = (() => {
    if (tone === 'red') return 'bg-[var(--m03-red)] text-white border-transparent';
    if (tone === 'green') return 'bg-[var(--m03-green)] text-white border-transparent';
    if (tone === 'orange') return 'bg-[var(--m03-orange)] text-white border-transparent';
    return active
      ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)] border-[var(--m03-fg)]'
      : 'bg-transparent text-[var(--m03-fg-2)] border-[var(--m03-line)]';
  })();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[12px] border',
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Tag({
  status,
  children,
}: {
  status: 'ready' | 'processing' | 'draft' | 'failed';
  children?: React.ReactNode;
}) {
  const map: Record<string, string> = {
    ready: 'bg-[var(--m03-green)] text-white',
    processing: 'bg-[var(--m03-orange)] text-white',
    draft: 'bg-[var(--m03-line-2)] text-[var(--m03-fg-2)]',
    failed: 'bg-[var(--m03-red)] text-white',
  };
  const label =
    children ??
    (status === 'ready'
      ? 'Ready'
      : status === 'processing'
        ? 'Processing'
        : status === 'draft'
          ? 'Draft'
          : 'Failed');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium font-mono uppercase tracking-wider',
        map[status],
      )}
    >
      {label}
    </span>
  );
}
