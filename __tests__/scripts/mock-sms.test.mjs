import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../scripts/mock-sms.mjs', import.meta.url),
  'utf8',
);

function functionSource(name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find ${name} source boundaries`);
  }
  return source.slice(start, end);
}

describe('mock SMS delivery status command', () => {
  it('routes RPC calls through the InsForge database endpoint with service credentials', () => {
    expect(source).toContain(
      '`${BASE_URL}/api/database/rpc/${encodeURIComponent(functionName)}`',
    );
    expect(source).toContain('Authorization: `Bearer ${SERVICE_KEY}`');
  });

  it('uses the monotonic status RPC instead of directly patching messages', () => {
    const cmdStatus = functionSource('cmdStatus', 'cmdReply');

    expect(cmdStatus).toContain("db.rpc(\n    'advance_message_delivery_status'");
    expect(cmdStatus).toContain('p_message_id: msg.id');
    expect(cmdStatus).toContain('p_delivery_status: deliveryStatus');
    expect(cmdStatus).not.toContain(".from('messages')\n    .update(");
  });

  it('reports the effective status returned by the RPC when a stale update is ignored', () => {
    const cmdStatus = functionSource('cmdStatus', 'cmdReply');

    expect(cmdStatus).toContain('updatedMessage.delivery_status');
    expect(cmdStatus).not.toContain('${msg.delivery_status} → ${deliveryStatus}');
  });
});
