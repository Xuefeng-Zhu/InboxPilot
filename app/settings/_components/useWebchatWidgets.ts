'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readResponseJsonObject } from '@/lib/http-json';
import { insforge, getAccessToken } from '@/lib/insforge';

export const WEBCHAT_WIDGET_SAFE_COLUMNS =
  'id,organization_id,name,widget_token,allowed_domains,position,primary_color,greeting,pre_chat_enabled,ai_mode_override,is_active,created_at,updated_at' as const;

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
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    if (!orgId) {
      setWidgets([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error: err } = await insforge.database
      .from('webchat_widgets')
      .select(WEBCHAT_WIDGET_SAFE_COLUMNS)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (requestGeneration !== requestGenerationRef.current) return;

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
      const payload = await readResponseJsonObject(res, 'delete-widget error');
      if (!res.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : `Delete failed (${res.status})`,
        );
      }
      await refresh();
    },
    [orgId, refresh],
  );

  useEffect(() => {
    void refresh();
    return () => {
      requestGenerationRef.current++;
    };
  }, [refresh]);

  return { widgets, loading, error, refresh, deleteWidget };
}
