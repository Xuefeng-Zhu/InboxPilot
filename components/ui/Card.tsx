import React from 'react';
import { cn } from './cn';

interface CardProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  elevated?: boolean;
  className?: string;
}

export function Card({ children, header, elevated, className }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--m03-line)] bg-white p-4',
        elevated && 'shadow-level-2',
        className,
      )}
    >
      {header && (
        <div className="mb-3 border-b border-[var(--m03-line)] pb-3">{header}</div>
      )}
      {children}
    </div>
  );
}
