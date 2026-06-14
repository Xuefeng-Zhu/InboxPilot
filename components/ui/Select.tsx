'use client';

import React, { forwardRef } from 'react';
import { cn } from './cn';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  className?: string;
}

const baseClasses =
  'block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)] disabled:opacity-50';

const errorClasses = 'border-[var(--m03-red)] focus:border-[var(--m03-red)] focus:ring-[var(--m03-red)]';

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const errorId = error && selectId ? `${selectId}-error` : undefined;

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          className={cn(baseClasses, error && errorClasses)}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="mt-1 text-[12px] text-[var(--m03-red)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';
