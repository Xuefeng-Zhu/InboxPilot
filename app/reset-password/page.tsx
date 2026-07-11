'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { Topbar } from '@/components/Topbar';
import { insforge } from '@/lib/insforge';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const linkToken = searchParams.get('token') ?? '';
  const redirectStatus = searchParams.get('insforge_status');
  const redirectError = searchParams.get('insforge_error');
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(
    redirectStatus === 'error' ? redirectError ?? 'This reset link is invalid or expired.' : null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      let otp = linkToken;
      if (!otp) {
        if (!email.trim() || !code.trim()) {
          setError('Email and reset code are required.');
          return;
        }
        const { data, error: exchangeError } = await insforge.auth.exchangeResetPasswordToken({
          email: email.trim(),
          code: code.trim(),
        });
        if (exchangeError || !data?.token) {
          setError(exchangeError?.message ?? 'The reset code is invalid or expired.');
          return;
        }
        otp = data.token;
      }

      const { error: resetError } = await insforge.auth.resetPassword({
        newPassword: password,
        otp,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setComplete(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not reset password.');
    } finally {
      setSaving(false);
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
            <h1 className="m-0 text-[18px] font-medium">Choose a new password</h1>
          </div>

          {complete ? (
            <div className="text-center">
              <p role="status" className="rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] px-3 py-3 text-[13px] text-[var(--m03-green)]">
                Your password has been updated.
              </p>
              <Link href="/login" className="mt-4 inline-block text-[13px] text-[var(--m03-fg)] hover:underline">Sign in →</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              {error && (
                <p role="alert" className="rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-3 py-2 text-center text-[13px] text-[var(--m03-red)]">
                  {error}
                </p>
              )}

              {!linkToken && (
                <>
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Email
                    <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] normal-case tracking-normal focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]" />
                  </label>
                  <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Reset code
                    <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} className="mt-1.5 block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 font-mono text-[13px] normal-case tracking-widest focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]" />
                  </label>
                </>
              )}

              <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                New password
                <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] normal-case tracking-normal focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]" />
              </label>
              <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                Confirm password
                <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] normal-case tracking-normal focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]" />
              </label>
              <button type="submit" disabled={saving} className="rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-2.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)] disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
