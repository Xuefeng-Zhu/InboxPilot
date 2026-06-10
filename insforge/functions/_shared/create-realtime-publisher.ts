/**
 * Shared utility: creates a RealtimePublisher that publishes events
 * via the InsForge Realtime REST API.
 *
 * InsForge Realtime exposes a REST endpoint for server-side event publishing:
 *   POST {baseUrl}/realtime/v1/api/broadcast
 *
 * This avoids needing a WebSocket connection from within a serverless function.
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
      const url = `${baseUrl}/realtime/v1/api/broadcast`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          channel,
          event,
          payload: data,
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
