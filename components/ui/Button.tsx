'use client';

import React, { forwardRef } from 'react';
import { cn } from './cn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'border border-[var(--m03-fg)] bg-[var(--m03-fg)] text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]',
  secondary:
    'border border-[var(--m03-line)] bg-white text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-7 px-3 text-[12px]',
  md: 'h-8 px-3.5 text-[13px]',
  lg: 'h-10 px-4 text-[14px]',
};

const baseClasses =
  'inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', disabled, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
