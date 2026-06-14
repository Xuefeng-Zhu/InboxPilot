'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from './cn';

export interface SelectProps {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
}

const baseClasses =
  'flex h-9 w-full items-center justify-between rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)] disabled:opacity-50 data-[placeholder]:text-[var(--m03-fg-3)]';

const errorClasses =
  'border-[var(--m03-red)] focus:border-[var(--m03-red)] focus:ring-[var(--m03-red)]';

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    { label, error, options, value, onValueChange, disabled, id, className, placeholder },
    ref,
  ) => {
    const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
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
        <SelectPrimitive.Root
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={selectId}
            aria-describedby={errorId}
            aria-invalid={error ? true : undefined}
            className={cn(baseClasses, error && errorClasses)}
          >
            <SelectPrimitive.Value placeholder={placeholder} />
            <SelectPrimitive.Icon asChild>
              <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={4}
              className="z-[100] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-[var(--m03-line)] bg-white shadow-level-2"
            >
              <SelectPrimitive.Viewport className="p-1">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-[13px] text-[var(--m03-fg)] outline-none data-[highlighted]:bg-[var(--m03-line-2)] data-[disabled]:opacity-50 data-[disabled]:pointer-events-none"
                  >
                    <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex h-3.5 w-3.5 items-center justify-center">
                      <Check className="h-3.5 w-3.5" />
                    </SelectPrimitive.ItemIndicator>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
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
