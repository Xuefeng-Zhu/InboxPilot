'use client';

import React, { forwardRef, useId } from 'react';
import { cn } from './cn';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  className?: string;
}

const baseClasses =
  'block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)] disabled:opacity-50';

const errorClasses = 'border-[var(--m03-red)] focus:border-[var(--m03-red)] focus:ring-[var(--m03-red)]';

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          className={cn(baseClasses, error && errorClasses)}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-[12px] text-[var(--m03-red)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
