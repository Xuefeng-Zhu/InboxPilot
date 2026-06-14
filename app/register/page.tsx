'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth-context';
import { createOrganizationWithOwner } from '@/lib/onboarding';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function RegisterPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedWorkspaceName = workspaceName.trim();

    if (!trimmedWorkspaceName) {
      setError('Workspace name is required.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const { error: signUpError } = await signUp(email, password);
      if (signUpError) {
        setError('Unable to create account. Please try again.');
        return;
      }

      const { error: workspaceError } =
        await createOrganizationWithOwner(trimmedWorkspaceName);

      if (workspaceError) {
        setError('Account created, but unable to create workspace. Please sign in and try again.');
        return;
      }

      router.push('/inbox');
    } catch {
      setError('Unable to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-[420px] rounded-lg border border-[var(--m03-line)] bg-white p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[18px] font-medium tracking-tight text-[var(--m03-fg)]">
            <BrandMark size={20} className="text-[var(--m03-fg)]" />
            InboxPilot
          </div>
          <h1 className="m-0 text-[18px] font-medium tracking-tight text-[var(--m03-fg)]">
            Create your account
          </h1>
          <p className="m-0 text-center text-[13px] text-[var(--m03-fg-2)]">
            Start your free workspace in 30 seconds.
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
          <Input
            label="Workspace Name"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="My Workspace"
            required
          />

          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <Input
            label="Confirm Password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            className="mt-1 w-full"
          >
            {loading ? 'Signing up…' : 'Sign up'}
          </Button>
        </form>

        <p className="mt-5 text-center text-[12px] text-[var(--m03-fg-2)]">
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--m03-fg)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
