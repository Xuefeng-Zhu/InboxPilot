export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">InboxPilot</h1>
      <p className="mt-4 text-lg text-gray-600">
        AI-powered customer support for SMS and email.
      </p>
      <nav className="mt-8 flex gap-4" aria-label="Main navigation">
        <a
          href="/inbox"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Go to Inbox
        </a>
        <a
          href="/login"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Sign In
        </a>
      </nav>
    </main>
  );
}
