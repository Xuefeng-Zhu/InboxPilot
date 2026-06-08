'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '../ui/cn';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

export function NavItem({ href, icon, label, isActive }: NavItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 text-body-md cursor-pointer transition-colors duration-150',
        isActive
          ? 'border-l-2 border-l-primary bg-surface-container text-primary font-medium'
          : 'border-l-2 border-l-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
