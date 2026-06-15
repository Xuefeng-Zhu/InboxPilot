'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/components/ui/cn';

export interface SidebarCollapseToggleProps {
  /** Whether the sidebar is currently collapsed. */
  collapsed: boolean;
  /** Called when the user clicks the toggle. */
  onToggle: () => void;
}

export function SidebarCollapseToggle({ collapsed, onToggle }: SidebarCollapseToggleProps) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-controls="primary-sidebar"
      data-testid="sidebar-collapse-toggle"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'w-full text-[var(--m03-fg-3)] hover:text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]',
        collapsed ? 'px-0 justify-center' : 'justify-between',
      )}
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <>
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Collapse</span>
        </>
      )}
    </Button>
  );

  if (collapsed) {
    return (
      <Tooltip content="Expand sidebar" side="right">
        {button}
      </Tooltip>
    );
  }

  return button;
}
