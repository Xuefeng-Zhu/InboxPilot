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
  'w-full border border-gray-300 rounded px-3 py-2 text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-1 focus:outline-none transition-colors duration-150';

const errorClasses =
  'border-red-500 focus:border-red-500 focus:ring-red-500/20';

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
            className="text-label-md text-gray-700 mb-1 block"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          className={cn(
            baseClasses,
            error && errorClasses
          )}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
