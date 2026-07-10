import type { RealtimePublisher } from '../../../packages/support-core/src/interfaces/realtime-publisher.ts';

/**
 * Publish a notification without turning a completed business operation into
 * a retry. Realtime is an observation channel; provider sends and durable
 * database writes remain the source of truth.
 */
export async function publishRealtimeBestEffort(
  realtime: RealtimePublisher,
  channel: string,
  event: string,
  data: unknown,
  context: string,
): Promise<boolean> {
  try {
    await realtime.publish(channel, event, data);
    return true;
  } catch (err) {
    console.error(
      `${context}: realtime publish failed for ${channel}/${event}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return false;
  }
}
