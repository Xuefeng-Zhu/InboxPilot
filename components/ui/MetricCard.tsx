import React from 'react';
import { cn } from './cn';
import { Card } from './Card';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down'; value: string };
  accentColor?: 'primary' | 'ai' | 'status-open' | 'status-resolved';
  className?: string;
}

const accentColorMap: Record<string, string> = {
  primary: 'border-l-primary',
  ai: 'border-l-ai',
  'status-open': 'border-l-status-open',
  'status-resolved': 'border-l-status-resolved',
};

export function MetricCard({ label, value, trend, accentColor, className }: MetricCardProps) {
  return (
    <Card
      className={cn(
        accentColor && 'border-l-2',
        accentColor && accentColorMap[accentColor],
        className
      )}
    >
      <div className="text-display-sm font-semibold">{value}</div>
      <div className="text-label-md text-gray-500">{label}</div>
      {trend && (
        <div
          className={cn(
            'text-body-sm mt-1',
            trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
          )}
        >
          {trend.direction === 'up' ? '↑' : '↓'} {trend.value}
        </div>
      )}
    </Card>
  );
}
