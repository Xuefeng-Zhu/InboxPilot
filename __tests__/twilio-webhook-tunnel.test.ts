/**
 * Twilio Webhook Tunnel Test (end-to-end)
 *
 * Reproduces the "send a real Twilio sandbox SMS → see it land in the
 * InboxPilot inbox" loop in CI, using `localtunnel` to expose a local
 * HTTP server that runs the same Twilio-adapter verification +
 * `InboundMessageService` pipeline the deployed `sms-inbound` InsForge
 * function uses.
 *
 * Why: the production webhook flow needs a publicly reachable HTTPS
 * endpoint (Twilio will not POST to localhost). This test proves that
 * the local pipeline (verify signature → parse → create contact →
 * create conversation → create message → enqueue AI job → audit log)
 * survives a real round-trip through a tunnel.
 *
 * How:
 *  1. Start a local HTTP server on a free port that handles the
 *     `/webhooks/sms/twilio` path.
 *  2. Open a localtunnel to that port; capture the public URL.
 *  3. Compute a valid Twilio HMAC-SHA1 signature for the *tunnel* URL
 *     (Twilio's signature is over the public URL the request hits).
 *  4. POST a realistic Twilio form-encoded payload through the tunnel.
 *  5. Assert the server received, verified, parsed, and processed the
 *     message end-to-end (mocks capture every step).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac } from 'crypto';
import { Readable } from 'stream';
import localtunnel from 'localtunnel';

import { TwilioSmsAdapter } from '@support-core/adapters/twilio-sms-adapter';
import { InboundMessageService } from '@support-core/services/inbound-message-service';
import type { ContactRepository } from '@support-core/repositories/contact-repository';
import type { ConversationRepository } from '@support-core/repositories/conversation-repository';
import type { MessageRepository } from '@support-core/repositories/message-repository';
import type { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import type { JobQueue } from '@support-core/interfaces/job-queue';
import type {
  Contact,
  Conversation,
  Message,
  AuditLog,
  Job,
} from '@support-core/types/index';

// ─── Test fixtures ─────────────────────────────────────────────────

const ORG_ID = 'org-tunnel-test';
const TWILIO_AUTH_TOKEN = 'twilio-test-auth-token-do-not-use-in-prod';
const FROM_PHONE = '+155****0001';
const TO_PHONE = '+155****9999';
const MESSAGE_BODY = 'Hello from a Twilio webhook through a tunnel!';

const SAMPLE_CONTACT: Contact = {
  id: 'contact-tunnel-001',
  organizationId: ORG_ID,
  name: null,
  email: null,
  phone: '+155****0001',
  metadata: {},
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const SAMPLE_CONVERSATION: Conversation = {
  id: 'conv-tunnel-001',
  organizationId: ORG_ID,
  contactId: 'contact-tunnel-001',
  channel: 'sms',
  status: 'open',
  aiState: 'idle',
  subject: null,
  assignedTo: null,
  lastMessageAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const SAMPLE_MESSAGE: Message = {
  id: 'msg-tunnel-001',
  conversationId: 'conv-tunnel-001',
  senderType: 'contact',
  senderId: null,
  direction: 'inbound',
  channel: 'sms',
  body: MESSAGE_BODY,
  subject: null,
  rawPayload: {},
  provider: 'twilio',
  providerAccountId: null,
  externalMessageId: 'SMtunnel0000000000000000000000000001',
  deliveryStatus: 'delivered',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

const SAMPLE_AUDIT_LOG: AuditLog = {
  id: 'audit-tunnel-001',
  organizationId: ORG_ID,
  actorId: null,
  actorType: 'system',
  action: 'message_received',
  resourceType: 'message',
  resourceId: 'msg-tunnel-001',
  metadata: {},
  createdAt: new Date('2024-01-01T00:00:00Z'),
};

// ─── Twilio signature helpers ─────────────────────────────────────

/**
 * Compute a valid Twilio request signature for a given URL and form params.
 * The algorithm matches the production `TwilioSmsAdapter` (HMAC-SHA1, base64).
 */
function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data).digest('base64');
}

function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Build a realistic Twilio inbound SMS payload. Fields mirror what Twilio
 * actually POSTs — see https://www.twilio.com/docs/messaging/webhooks
 */
function buildTwilioPayload(): Record<string, string> {
  return {
    From: FROM_PHONE,
    To: TO_PHONE,
    Body: MESSAGE_BODY,
    MessageSid: 'SMtunnel0000000000000000000000000001',
    AccountSid: 'ACtunnel0000000000000000000000000001',
    NumMedia: '0',
    SmsStatus: 'received',
    ApiVersion: '2010-04-01',
  };
}

// ─── Mock repositories ────────────────────────────────────────────

function makeContactRepo(): ContactRepository {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_CONTACT),
    update: vi.fn().mockResolvedValue(SAMPLE_CONTACT),
  } as unknown as ContactRepository;
}

function makeConversationRepo(): ConversationRepository {
  return {
    findOpenByContactAndChannel: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    update: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    listByOrg: vi.fn().mockResolvedValue([]),
  } as unknown as ConversationRepository;
}

function makeMessageRepo(): MessageRepository {
  // Mimic a real repo: return null on duplicate check, then return the
  // created message on insert. `findByExternalId` is what the production
  // dedup check calls (provider, externalMessageId).
  return {
    findByExternalId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_MESSAGE),
  } as unknown as MessageRepository;
}

function makeJobQueue(): JobQueue {
  return {
    enqueue: vi.fn().mockResolvedValue({
      id: 'job-tunnel-001',
      organizationId: ORG_ID,
      jobType: 'process_ai_message',
      payload: {
        conversationId: SAMPLE_CONVERSATION.id,
        messageId: SAMPLE_MESSAGE.id,
      },
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      runAfter: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    } as Job),
  } as unknown as JobQueue;
}

function makeAuditLogRepo(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;
}

// ─── Local HTTP server that runs the production webhook pipeline ──

interface ServerHandles {
  server: Server;
  port: number;
  requests: Array<{ method: string; url: string; body: string; signature: string | undefined }>;
  responses: Array<{ status: number; body: string }>;
  inboundService: InboundMessageService;
  contactRepo: ContactRepository;
  conversationRepo: ConversationRepository;
  messageRepo: MessageRepository;
  jobQueue: JobQueue;
  auditLog: AuditLogRepository;
}

/**
 * Read the full request body from an IncomingMessage. Compatible with
 * the server-side flow in `insforge/functions/sms-inbound/index.ts`.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function startLocalServer(): Promise<ServerHandles> {
  const adapter = new TwilioSmsAdapter();
  const contactRepo = makeContactRepo();
  const conversationRepo = makeConversationRepo();
  const messageRepo = makeMessageRepo();
  const jobQueue = makeJobQueue();
  const auditLog = makeAuditLogRepo();

  const inboundService = new InboundMessageService(
    contactRepo,
    conversationRepo,
    messageRepo,
    jobQueue,
    auditLog
  );

  const handles: ServerHandles = {
    server: undefined as unknown as Server,
    port: 0,
    requests: [],
    responses: [],
    inboundService,
    contactRepo,
    conversationRepo,
    messageRepo,
    jobQueue,
    auditLog,
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      // Twilio performs a GET to verify the URL is alive before saving it
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/webhooks/sms/twilio')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const body = await readBody(req);
    handles.requests.push({
      method: req.method!,
      url: req.url!,
      body,
      signature: req.headers['x-twilio-signature'] as string | undefined,
    });

    // Reconstruct the full URL the way the request hit it. Twilio signs
    // the public URL, so when the request arrives via localtunnel we must
    // use the tunnel URL — the adapter takes the URL via x-webhook-url.
    const tunnelUrl = req.headers['x-webhook-url'] as string | undefined;
    if (!tunnelUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing x-webhook-url header' }));
      handles.responses.push({ status: 400, body: 'missing x-webhook-url' });
      return;
    }

    // 1. Verify signature
    const valid = await adapter.verifyWebhook({
      headers: {
        'x-twilio-signature': req.headers['x-twilio-signature'] as string,
        'x-webhook-url': tunnelUrl,
      },
      body,
      signingSecret: TWILIO_AUTH_TOKEN,
    });
    if (!valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      handles.responses.push({ status: 401, body: 'invalid signature' });
      return;
    }

    // 2. Parse
    const normalized = adapter.parseInboundWebhook(body);

    // 3. Process via the same service the deployed function uses
    try {
      const message = await inboundService.processInboundSms(
        normalized,
        ORG_ID,
        'twilio'
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', data: message }));
      handles.responses.push({ status: 200, body: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error', message: msg }));
      handles.responses.push({ status: 500, body: msg });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Could not determine local server port');
  }
  handles.server = server;
  handles.port = addr.port;
  return handles;
}

// ─── Suite ────────────────────────────────────────────────────────

describe('Twilio webhook via localtunnel (end-to-end)', () => {
  let handles: ServerHandles;
  let tunnel: { url: string; close: () => Promise<void> } | undefined;

  beforeAll(async () => {
    handles = await startLocalServer();
    // localtunnel allocates a random *.loca.lt subdomain. No account, no
    // config — it just works.
    tunnel = await localtunnel({ port: handles.port });
  }, 30000);

  afterAll(async () => {
    if (tunnel) {
      try {
        await tunnel.close();
      } catch {
        // tunnel may already be closed
      }
    }
    if (handles?.server) {
      await new Promise<void>((resolve) => handles.server.close(() => resolve()));
    }
  });

  it('exposes the local server on a public https://*.loca.lt URL', async () => {
    expect(tunnel?.url).toMatch(/^https:\/\/[a-z0-9-]+\.loca\.lt$/);
    // The tunnel should proxy GETs to the local server.
    const res = await fetch(`${tunnel!.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('processes a real Twilio-formatted webhook delivered through the tunnel', async () => {
    const payload = buildTwilioPayload();
    const formBody = toFormBody(payload);
    // The signature is computed over the public URL Twilio sees — which
    // for this test is the tunnel URL.
    const signature = computeTwilioSignature(
      TWILIO_AUTH_TOKEN,
      `${tunnel!.url}/webhooks/sms/twilio`,
      payload
    );

    const res = await fetch(`${tunnel!.url}/webhooks/sms/twilio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': signature,
        // The deployed function reads x-webhook-url so the adapter can
        // reconstruct the full public URL for signature verification.
        // Production gets this from a request-transform middleware;
        // the test sends it explicitly.
        'X-Webhook-Url': `${tunnel!.url}/webhooks/sms/twilio`,
      },
      body: formBody,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: { id: string } };
    expect(body.status).toBe('ok');
    expect(body.data.id).toBe(SAMPLE_MESSAGE.id);

    // The local server should have received exactly one request.
    expect(handles.requests).toHaveLength(1);
    const received = handles.requests[0];
    expect(received.method).toBe('POST');
    expect(received.url).toBe('/webhooks/sms/twilio');
    expect(received.signature).toBe(signature);
    // The form body should round-trip intact.
    expect(received.body).toContain(`From=${encodeURIComponent(FROM_PHONE)}`);
    expect(received.body).toContain(`Body=${encodeURIComponent(MESSAGE_BODY)}`);

    // And the production pipeline should have run end-to-end:
    // contact upsert → conversation upsert → message insert → AI job → audit log.
    expect(handles.contactRepo.findByPhone).toHaveBeenCalledWith(
      ORG_ID,
      expect.stringContaining('+155')
    );
    expect(handles.contactRepo.create).toHaveBeenCalled();
    expect(handles.conversationRepo.findOpenByContactAndChannel).toHaveBeenCalledWith(
      SAMPLE_CONTACT.id,
      'sms'
    );
    expect(handles.conversationRepo.create).toHaveBeenCalled();
    expect(handles.messageRepo.create).toHaveBeenCalled();
    expect(handles.jobQueue.enqueue).toHaveBeenCalledWith(
      'process_ai_message',
      expect.objectContaining({
        messageId: SAMPLE_MESSAGE.id,
        conversationId: SAMPLE_CONVERSATION.id,
      }),
      ORG_ID
    );
    expect(handles.auditLog.create).toHaveBeenCalled();
  });

  it('rejects a Twilio webhook with an invalid signature (401)', async () => {
    const payload = buildTwilioPayload();
    payload.MessageSid = 'SMtunnel0000000000000000000000000002';
    const formBody = toFormBody(payload);
    // Wrong signature — signed with the wrong auth token.
    const badSignature = computeTwilioSignature(
      'wrong-token',
      `${tunnel!.url}/webhooks/sms/twilio`,
      payload
    );

    const res = await fetch(`${tunnel!.url}/webhooks/sms/twilio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': badSignature,
        'X-Webhook-Url': `${tunnel!.url}/webhooks/sms/twilio`,
      },
      body: formBody,
    });

    expect(res.status).toBe(401);
    // The pipeline should NOT have run.
    expect(handles.contactRepo.create).toHaveBeenCalledTimes(1); // unchanged from previous test
    expect(handles.messageRepo.create).toHaveBeenCalledTimes(1);
    expect(handles.jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

// Silence the unused-import warning for Readable (kept for future
// streaming-body support if the tunnel ever emits chunked encoding).
void Readable;
