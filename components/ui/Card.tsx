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
        'bg-white border border-surface-border rounded-lg p-section-padding',
        elevated && 'shadow-level-2',
        className
      )}
    >
      {header && (
        <div className="border-b border-surface-border pb-3 mb-3">
          {header}
        </div>
      )}
      {children}
    </div>
  );
}
