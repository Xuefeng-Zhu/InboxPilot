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
  'w-full border border-surface-border rounded px-3 py-2 text-body-md focus:border-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-1 focus:outline-none transition-colors duration-150';

const errorClasses = 'border-red-500 focus:border-red-500 focus:ring-red-500/20';

const labelClasses = 'text-label-md text-gray-700 mb-1 block';

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
          <p id={errorId} className="text-sm text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
