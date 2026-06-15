'use client';

import { useCallback, useState } from 'react';
import { insforge, getAccessToken } from '@/lib/insforge';

export interface WebchatWidgetRow {
  id: string;
  organization_id: string;
  name: string;
  widget_token: string;
  allowed_domains: string[];
  position: 'bottom-right' | 'bottom-left';
  primary_color: string | null;
  greeting: string | null;
  pre_chat_enabled: boolean;
  ai_mode_override: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useWebchatWidgets(orgId: string | null) {
  const [widgets, setWidgets] = useState<WebchatWidgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error: err } = await insforge.database
      .from('webchat_widgets')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (err) {
      setError(err.message);
    } else {
      setWidgets(Array.isArray(data) ? (data as WebchatWidgetRow[]) : []);
      setError(null);
    }
    setLoading(false);
  }, [orgId]);

  const deleteWidget = useCallback(
    async (widgetId: string): Promise<void> => {
      if (!orgId) {
        throw new Error('No active organization');
      }
      const token = getAccessToken();
      const res = await fetch('/api/functions/delete-widget', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organizationId: orgId, widgetId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        data?: unknown;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? `Delete failed (${res.status})`);
      }
      await refresh();
    },
    [orgId, refresh],
  );

  useState(() => { refresh(); });

  return { widgets, loading, error, refresh, deleteWidget };
}
