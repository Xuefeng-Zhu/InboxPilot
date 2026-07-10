import { insforgeAdmin as insforge } from '@/lib/insforge-admin';

export async function publishRealtimeMessage(
  channel: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceRoleKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error(
      `publishRealtimeMessage: missing ${!baseUrl ? 'NEXT_PUBLIC_INSFORGE_URL' : 'INSFORGE_SERVICE_ROLE_KEY'}`,
    );
  }

  const { error } = await insforge.database.rpc('publish_realtime_message', {
    p_channel_name: channel,
    p_event_name: event,
    p_payload: payload,
  });

  if (error) {
    throw new Error(`publishRealtimeMessage failed: ${error.message}`);
  }
}
