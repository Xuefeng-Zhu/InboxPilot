import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-background">
      <div className="text-center">
        <p className="text-display-sm text-gray-900">404</p>
        <p className="mt-2 text-body-md text-gray-500">Page not found</p>
        <Link
          href="/inbox"
          className="mt-4 inline-block rounded bg-primary px-4 py-2 text-body-sm font-medium text-white hover:bg-primary-600 transition-colors"
        >
          Go to Inbox
        </Link>
      </div>
    </div>
  );
}
