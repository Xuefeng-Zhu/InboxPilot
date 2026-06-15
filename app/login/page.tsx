'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Topbar } from '@/components/Topbar';
import { BrandMark } from '@/components/BrandMark';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);

  // Skip login page if already authenticated
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/inbox');
    }
  }, [authLoading, user, router]);

  // Show nothing while auth state is loading to avoid flash of the login form
  if (authLoading) {
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email, password, remember);
      if (signInError) {
        setError('Invalid credentials. Please try again.');
        return;
      }
      router.push('/inbox');
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-[var(--m03-fg)]">
      <Topbar />

      <main className="flex flex-1 items-center justify-center px-6 py-15">
        <div className="w-full max-w-[420px] rounded-lg border border-[var(--m03-line)] bg-white p-8">
          <div className="mb-7 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-[18px] font-medium tracking-tight">
              <BrandMark size={20} className="text-[var(--m03-fg)]" />
              InboxPilot
            </div>
            <h1 className="m-0 text-[18px] font-medium">Sign in to your account</h1>
            <p className="m-0 text-center text-[13px] text-[var(--m03-fg-2)]">
              Welcome back. Enter your credentials to continue.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="mb-3 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-3 py-2 text-center text-[13px] text-[var(--m03-red)]"
            >
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[12px] text-[var(--m03-fg-2)]">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="cursor-pointer"
                />
                Remember me
              </label>
              <Link
                href="#"
                className="text-[12px] text-[var(--m03-fg)] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-2.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)] disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-5 text-center text-[12px] text-[var(--m03-fg-2)]">
            Don&rsquo;t have an account?{' '}
            <Link href="/register" className="text-[var(--m03-fg)] hover:underline">
              Start free →
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
