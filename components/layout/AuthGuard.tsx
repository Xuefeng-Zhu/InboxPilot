'use client';

import { useAuth } from '@/lib/auth-context';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Centralised auth guard — shows a loading state while auth hydrates,
 * and a sign-in prompt if the user is somehow unauthenticated
 * (edge case since middleware already redirects).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-container-margin">
        <p className="text-body-md text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-container-margin">
        <p className="text-body-md text-red-600">Please sign in to continue.</p>
      </div>
    );
  }

  return <>{children}</>;
}
