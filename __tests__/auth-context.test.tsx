/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth-context';

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    auth: authMocks,
  },
}));

function AuthHarness() {
  const { user, loading, signIn, signUp, signOut } = useAuth();
  if (loading) return <p>loading</p>;

  return (
    <div>
      <p data-testid="user-id">{user?.id ?? 'signed-out'}</p>
      <button type="button" onClick={() => void signIn('b@example.com', 'password')}>
        Sign in B
      </button>
      <button type="button" onClick={() => void signUp('c@example.com', 'password')}>
        Sign up C
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

describe('AuthProvider query-cache isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getCurrentUser.mockResolvedValue({
      data: { user: { id: 'user-a', email: 'a@example.com' } },
      error: null,
    });
    authMocks.signInWithPassword.mockResolvedValue({
      data: {
        accessToken: 'token-b',
        user: { id: 'user-b', email: 'b@example.com' },
      },
      error: null,
    });
    authMocks.signUp.mockResolvedValue({
      data: {
        accessToken: 'token-c',
        user: { id: 'user-c', email: 'c@example.com' },
      },
      error: null,
    });
    authMocks.signOut.mockResolvedValue({ data: null, error: null });
  });

  it('clears cached tenant data on sign-in, sign-up, and sign-out transitions', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe('user-a'));

    queryClient.setQueryData(['contacts', 'org-a'], [{ id: 'contact-a' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in B' }));
    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe('user-b'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);

    queryClient.setQueryData(['knowledge-documents', 'org-b'], [{ id: 'doc-b' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign up C' }));
    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe('user-c'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);

    queryClient.setQueryData(['team-members', 'org-c'], [{ id: 'member-c' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe('signed-out'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
