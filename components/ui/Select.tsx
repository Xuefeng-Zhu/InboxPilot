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
  'w-full border border-gray-300 rounded px-3 py-2 text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-1 focus:outline-none transition-colors duration-150';

const errorClasses = 'border-red-500 focus:border-red-500 focus:ring-red-500/20';

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const errorId = error && selectId ? `${selectId}-error` : undefined;

    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={selectId}
            className="text-label-md text-gray-700 mb-1 block"
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
          <p id={errorId} className="mt-1 text-sm text-red-500">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
