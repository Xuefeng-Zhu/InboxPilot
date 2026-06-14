import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center">
        <p className="m-0 text-[64px] font-medium leading-none tracking-[-0.04em] text-[var(--m03-fg)]">
          404
        </p>
        <p className="mt-2 mb-0 text-[14px] text-[var(--m03-fg-2)]">Page not found</p>
        <Link
          href="/inbox"
          className="mt-5 inline-block rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-4 py-2 text-[13px] font-medium text-[var(--m03-bg)] transition-colors hover:bg-[var(--m03-fg-2)]"
        >
          Go to Inbox
        </Link>
      </div>
    </main>
  );
}
