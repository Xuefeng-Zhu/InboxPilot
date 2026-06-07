'use client';

import React, { forwardRef } from 'react';
import { cn } from './cn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'ai';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary text-white hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1',
  secondary: 'bg-white border border-surface-border text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1',
  ghost: 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-1',
  ai: 'bg-ai-50 border border-ai-200 text-ai-700 hover:bg-ai-100 focus:outline-none focus:ring-2 focus:ring-ai/20 focus:ring-offset-1',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-base',
};

const baseClasses = 'inline-flex items-center justify-center rounded font-medium transition-colors duration-150 cursor-pointer';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', disabled, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          disabled && 'opacity-50 pointer-events-none cursor-not-allowed',
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
