'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { Topbar } from '@/components/Topbar';
import { insforge } from '@/lib/insforge';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;

    setSending(true);
    setError(null);
    const redirectUrl = new URL('/reset-password', window.location.origin);
    redirectUrl.searchParams.set('email', normalizedEmail);

    try {
      const { error: resetError } = await insforge.auth.sendResetPasswordEmail({
        email: normalizedEmail,
        redirectTo: redirectUrl.toString(),
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send reset email.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-[var(--m03-fg)]">
      <Topbar />
      <main className="flex flex-1 items-center justify-center px-6 py-15">
        <div className="w-full max-w-[420px] rounded-lg border border-[var(--m03-line)] bg-white p-8">
          <div className="mb-7 flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2 text-[18px] font-medium tracking-tight">
              <BrandMark size={20} className="text-[var(--m03-fg)]" />
              InboxPilot
            </div>
            <h1 className="m-0 text-[18px] font-medium">Reset your password</h1>
            <p className="m-0 text-[13px] text-[var(--m03-fg-2)]">
              We’ll email a reset link or verification code, depending on your workspace configuration.
            </p>
          </div>

          {error && (
            <p role="alert" className="mb-3 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-3 py-2 text-center text-[13px] text-[var(--m03-red)]">
              {error}
            </p>
          )}

          {sent ? (
            <div className="text-center">
              <p role="status" className="rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] px-3 py-3 text-[13px] text-[var(--m03-green)]">
                Check your email for password-reset instructions.
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[12px]">
                <Link href={`/reset-password?email=${encodeURIComponent(email.trim())}`} className="text-[var(--m03-fg)] hover:underline">
                  Enter a reset code
                </Link>
                <button type="button" onClick={() => setSent(false)} className="text-[var(--m03-fg)] hover:underline">
                  Send again
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div>
                <label htmlFor="reset-email" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
                />
              </div>
              <button type="submit" disabled={sending || !email.trim()} className="rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-2.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)] disabled:cursor-not-allowed disabled:opacity-60">
                {sending ? 'Sending…' : 'Send reset instructions'}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-[12px] text-[var(--m03-fg-2)]">
            <Link href="/login" className="text-[var(--m03-fg)] hover:underline">← Back to sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
