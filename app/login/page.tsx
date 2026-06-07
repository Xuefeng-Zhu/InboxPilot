'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        // Generic error message — never reveal whether the email exists (Req 1.3, 17.3)
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
    <main className="min-h-screen bg-surface-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        {/* InboxPilot logo/brand */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <Logo size="lg" />
          <h1 className="text-headline-sm text-gray-900">InboxPilot</h1>
          <p className="text-body-sm text-gray-500">
            Sign in to your account
          </p>
        </div>

        {/* Error message */}
        {error && (
          <p role="alert" className="text-red-500 text-body-sm text-center mb-4">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {/* Link to registration */}
        <p className="text-center text-body-sm text-gray-500 mt-4">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-primary hover:text-primary-600 cursor-pointer"
          >
            Sign up
          </Link>
        </p>
      </Card>
    </main>
  );
}
