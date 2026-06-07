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
        'flex items-center gap-3 px-4 py-2 text-body-md cursor-pointer transition-colors duration-150',
        isActive
          ? 'bg-indigo-50 border-l-2 border-l-indigo-500 text-indigo-600 font-medium'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
