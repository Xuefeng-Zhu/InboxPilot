'use client';

import React, { forwardRef, useId } from 'react';
import { cn } from './cn';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  className?: string;
}

const baseClasses =
  'block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)] disabled:opacity-50';

const errorClasses = 'border-[var(--m03-red)] focus:border-[var(--m03-red)] focus:ring-[var(--m03-red)]';

const labelClasses = 'mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, rows = 4, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id || generatedId;
    const errorId = error ? `${textareaId}-error` : undefined;

    return (
      <div className={className}>
        {label && (
          <label htmlFor={textareaId} className={labelClasses}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
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

Textarea.displayName = 'Textarea';
