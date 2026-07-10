/**
 * Shared utility: creates a RealtimePublisher that publishes events
 * via the InsForge database RPC API.
 *
 * The native publisher is `realtime.publish(...)`, but the database RPC API
 * exposes public-schema functions only. Migration 013 creates a narrow
 * `public.publish_realtime_message(...)` wrapper for server-side callers.
 */

import type { RealtimePublisher } from '../../../packages/support-core/src/interfaces/realtime-publisher.ts';

/**
 * Create a RealtimePublisher that broadcasts events via the InsForge REST API.
 *
 * @param baseUrl - InsForge project base URL
 * @param serviceRoleKey - InsForge service role key for server-side access
 */
export function createRealtimePublisher(
  baseUrl: string,
  serviceRoleKey: string,
): RealtimePublisher {
  return {
    async publish(channel: string, event: string, data: unknown): Promise<void> {
      const url = `${baseUrl}/api/database/rpc/publish_realtime_message`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          p_channel_name: channel,
          p_event_name: event,
          p_payload: data,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        console.error(
          `RealtimePublisher.publish failed: HTTP ${res.status} — ${errorBody}`,
        );
        // Don't throw — realtime publish failures should not break the main flow
      }
    },
  };
}
