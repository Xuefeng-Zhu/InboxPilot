import Link from 'next/link';
import { BrandMark } from './BrandMark';

export interface TopbarNavItem {
  label: string;
  href: string;
}

interface TopbarProps {
  /** Optional nav links to render between the brand and the CTA. Pass `[]` to hide. */
  nav?: TopbarNavItem[];
  cta?: React.ReactNode;
}

export function Topbar({ nav, cta }: TopbarProps) {
  return (
    <header className="flex items-center gap-6 border-b border-[var(--m03-line)] bg-white px-6 h-14">
      <Link
        href="/"
        className="flex items-center gap-2 font-medium text-[14px] tracking-tight text-[var(--m03-fg)]"
      >
        <BrandMark size={16} className="text-[var(--m03-fg)]" />
        InboxPilot
      </Link>
      {nav && nav.length > 0 && (
        <nav className="flex items-center gap-4">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[13px] text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {cta ?? (
          <>
            <Link
              href="/login"
              className="rounded px-3 py-1.5 text-[13px] font-medium text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded bg-[var(--m03-fg)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)]"
            >
              Start free
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
