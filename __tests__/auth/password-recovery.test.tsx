/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '@/app/forgot-password/page';
import LoginPage from '@/app/login/page';
import ResetPasswordPage from '@/app/reset-password/page';

const navigation = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  sendResetPasswordEmail: vi.fn(),
  exchangeResetPasswordToken: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/Topbar', () => ({
  Topbar: () => <header>InboxPilot navigation</header>,
}));

vi.mock('@/components/BrandMark', () => ({
  BrandMark: () => <span aria-hidden="true">Logo</span>,
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    auth: authMocks,
  },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signIn: vi.fn(),
  }),
}));

describe('password recovery', () => {
  beforeEach(() => {
    navigation.search = '';
    vi.clearAllMocks();
    authMocks.sendResetPasswordEmail.mockResolvedValue({ data: null, error: null });
    authMocks.exchangeResetPasswordToken.mockResolvedValue({
      data: { token: 'exchanged-reset-token' },
      error: null,
    });
    authMocks.resetPassword.mockResolvedValue({ data: null, error: null });
  });

  it('links the sign-in screen to the password-recovery flow', () => {
    render(<LoginPage />);

    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe(
      '/forgot-password',
    );
  });

  it('requests a reset email with a usable callback and exposes the code fallback', async () => {
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  customer@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset instructions' }));

    await waitFor(() => expect(authMocks.sendResetPasswordEmail).toHaveBeenCalledTimes(1));
    const request = authMocks.sendResetPasswordEmail.mock.calls[0][0] as {
      email: string;
      redirectTo: string;
    };
    expect(request.email).toBe('customer@example.com');
    const redirect = new URL(request.redirectTo);
    expect(redirect.pathname).toBe('/reset-password');
    expect(redirect.searchParams.get('email')).toBe('customer@example.com');

    expect((await screen.findByRole('status')).textContent).toContain(
      'Check your email for password-reset instructions.',
    );
    expect(screen.getByRole('link', { name: 'Enter a reset code' }).getAttribute('href')).toBe(
      '/reset-password?email=customer%40example.com',
    );
  });

  it('updates the password directly when the email callback supplies a reset token', async () => {
    navigation.search = 'token=link-reset-token';
    render(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'correct-horse-1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(authMocks.resetPassword).toHaveBeenCalledWith({
        newPassword: 'correct-horse-1',
        otp: 'link-reset-token',
      });
    });
    expect(authMocks.exchangeResetPasswordToken).not.toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent).toContain(
      'Your password has been updated.',
    );
  });

  it('exchanges a manual email code before updating the password', async () => {
    navigation.search = 'email=customer%40example.com';
    render(<ResetPasswordPage />);

    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
      'customer@example.com',
    );
    fireEvent.change(screen.getByLabelText('Reset code'), {
      target: { value: ' 123456 ' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'correct-horse-2' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(authMocks.exchangeResetPasswordToken).toHaveBeenCalledWith({
        email: 'customer@example.com',
        code: '123456',
      });
      expect(authMocks.resetPassword).toHaveBeenCalledWith({
        newPassword: 'correct-horse-2',
        otp: 'exchanged-reset-token',
      });
    });
    expect((await screen.findByRole('status')).textContent).toContain(
      'Your password has been updated.',
    );
  });
});
