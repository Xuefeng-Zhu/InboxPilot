'use client';

import { Button, StatusBadge, Tooltip } from '@/components/ui';
import { mapStatusToBadge, formatDate, getStatusTooltip } from './types';

interface DocumentHeaderProps {
  title: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  sourceType: string;
  createdAt: string;
  updatedAt: string;
  editing: boolean;
  editTitle: string;
  onEditTitleChange: (value: string) => void;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function DocumentHeader({
  title,
  status,
  sourceType,
  createdAt,
  updatedAt,
  editing,
  editTitle,
  onEditTitleChange,
  saving,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: DocumentHeaderProps) {
  return (
    <div className="mt-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            className="block w-full rounded border border-surface-border px-3 py-2 text-headline-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        ) : (
          <h1 className="text-headline-sm text-gray-900">{title}</h1>
        )}
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <Tooltip content={getStatusTooltip(status)} side="bottom">
            <StatusBadge status={mapStatusToBadge(status)} />
          </Tooltip>
          <span className="text-body-sm text-gray-500 capitalize">{sourceType}</span>
          <span className="text-body-sm text-gray-400">Created {formatDate(createdAt)}</span>
          {updatedAt !== createdAt && (
            <span className="text-body-sm text-gray-400">· Updated {formatDate(updatedAt)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {editing ? (
          <>
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={onSave} disabled={saving || !editTitle.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-800">
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
