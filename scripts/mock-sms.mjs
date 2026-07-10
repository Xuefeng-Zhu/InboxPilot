#!/usr/bin/env node
/**
 * mock-sms.mjs — Simulate SMS send/receive using the MockSmsAdapter logic
 *
 * This script uses the @insforge/sdk (same as the app) to create contacts,
 * conversations, and messages — simulating the full inbound/outbound SMS flow.
 *
 * Usage:
 *   node scripts/mock-sms.mjs inbound                          # Customer sends SMS
 *   node scripts/mock-sms.mjs inbound "Help me with my order"  # Custom message
 *   node scripts/mock-sms.mjs status <messageId> delivered      # Delivery status
 *   node scripts/mock-sms.mjs reply <conversationId> "On it!"  # Send reply
 *   node scripts/mock-sms.mjs conversation "Billing question"  # Inbound + tip
 *
 * Reads .env.local automatically. Override with env vars:
 *   ORG_ID, FROM_NUMBER, TO_NUMBER
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function loadEnvFile() {
  const envPath = resolve(projectRoot, '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found
  }
}

loadEnvFile();

// ---------------------------------------------------------------------------
// InsForge Database Client (raw fetch, zero dependencies)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL || '';
const SERVICE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY || '';

async function readJsonOrFallback(res, fallback, context) {
  const text = await res.text();
  if (!text.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn(
      `mock-sms: could not parse ${context} JSON response: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallback;
  }
}

/**
 * Minimal PostgREST-compatible client for InsForge's /api/database/records/ endpoint.
 * Uses the service role key to bypass RLS.
 */
const db = {
  async query(table, { method = 'GET', body, filters = {}, select = '*', single = false, order, limit } = {}) {
    const url = new URL(`${BASE_URL}/api/database/records/${table}`);
    url.searchParams.set('select', select);

    for (const [key, val] of Object.entries(filters)) {
      url.searchParams.set(key, val);
    }
    if (order) url.searchParams.set('order', order);
    if (limit) url.searchParams.set('limit', String(limit));

    const headers = {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    };

    if (method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = 'return=representation';
    }
    if (single) {
      headers['Accept'] = 'application/vnd.pgrst.object+json';
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      // For single queries with no rows, PostgREST returns 406
      if (single && res.status === 406) return { data: null, error: null };
      const err = await readJsonOrFallback(
        res,
        { message: `HTTP ${res.status}` },
        `${method} ${table} error`,
      );
      return { data: null, error: { message: err.message || err.details || JSON.stringify(err) } };
    }

    const data = await readJsonOrFallback(res, null, `${method} ${table}`);
    return { data, error: null };
  },

  from(table) {
    return new QueryBuilder(table);
  },
};

class QueryBuilder {
  constructor(table) {
    this._table = table;
    this._method = 'GET';
    this._filters = {};
    this._select = '*';
    this._single = false;
    this._order = null;
    this._limit = null;
    this._body = null;
  }

  select(columns = '*') { this._select = columns; return this; }
  insert(body) { this._method = 'POST'; this._body = body; return this; }
  update(body) { this._method = 'PATCH'; this._body = body; return this; }
  delete() { this._method = 'DELETE'; return this; }
  eq(col, val) { this._filters[col] = `eq.${val}`; return this; }
  in(col, vals) { this._filters[col] = `in.(${vals.join(',')})`; return this; }
  order(col, opts = {}) { this._order = `${col}.${opts.ascending === false ? 'desc' : 'asc'}`; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._single = true; this._maybeSingle = true; return this; }

  async then(resolve, reject) {
    try {
      const result = await db.query(this._table, {
        method: this._method,
        body: this._body,
        filters: this._filters,
        select: this._select,
        single: this._single,
        order: this._order,
        limit: this._limit,
      });

      // For single results that return an array, unwrap
      if (this._single && Array.isArray(result.data)) {
        result.data = result.data[0] || null;
      }

      resolve(result);
    } catch (e) {
      if (reject) reject(e);
      else throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ORG_ID = process.env.ORG_ID || '';
const FROM_NUMBER = process.env.FROM_NUMBER || '+15551234567';
const TO_NUMBER = process.env.TO_NUMBER || '+15559876543';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHeader(title) {
  console.log('');
  console.log(c.cyan('━'.repeat(60)));
  console.log(c.cyan(`  ${title}`));
  console.log(c.cyan('━'.repeat(60)));
  console.log('');
}

function checkConfig() {
  if (!BASE_URL) {
    console.error(c.red('Error: NEXT_PUBLIC_INSFORGE_URL not set in .env.local'));
    process.exit(1);
  }
  if (!SERVICE_KEY) {
    console.error(c.red('Error: INSFORGE_SERVICE_ROLE_KEY not set in .env.local'));
    process.exit(1);
  }
}

async function resolveOrgId() {
  if (ORG_ID) return ORG_ID;

  // Try sms_phone_numbers lookup
  const { data: phoneRow } = await db
    .from('sms_phone_numbers')
    .select('organization_id')
    .eq('phone_number', TO_NUMBER)
    .limit(1)
    .maybeSingle();

  if (phoneRow?.organization_id) return phoneRow.organization_id;

  // Fallback: first organization
  const { data: orgRow } = await db
    .from('organizations')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (orgRow?.id) return orgRow.id;

  console.error(c.red('Error: Could not determine ORG_ID.'));
  console.error('  Set ORG_ID env var or ensure organizations table has data.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInbound(message = 'Hi, I need help with my order #12345') {
  const orgId = await resolveOrgId();
  const externalMessageId = `mock_inbound_${Date.now()}`;

  printHeader('Simulating Inbound SMS');
  console.log(`${c.yellow('From:')}     ${FROM_NUMBER} (customer)`);
  console.log(`${c.yellow('To:')}       ${TO_NUMBER} (your app)`);
  console.log(`${c.yellow('Body:')}     ${message}`);
  console.log(`${c.yellow('OrgID:')}    ${orgId}`);
  console.log('');

  // 1. Find or create contact
  console.log(c.dim('→ Finding/creating contact...'));
  const { data: existingContact } = await db
    .from('contacts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('phone', FROM_NUMBER)
    .limit(1)
    .maybeSingle();

  let contact = existingContact;
  if (!contact) {
    const { data: newContact, error: contactErr } = await db
      .from('contacts')
      .insert({
        organization_id: orgId,
        phone: FROM_NUMBER,
        name: `Customer ${FROM_NUMBER}`,
        metadata: { channel: 'sms' },
      })
      .select()
      .single();

    if (contactErr) {
      console.error(c.red(`  ✗ Failed to create contact: ${contactErr.message}`));
      process.exit(1);
    }
    contact = newContact;
    console.log(c.green(`  ✓ Created contact: ${contact.id}`));
  } else {
    console.log(c.dim(`  • Existing contact: ${contact.id}`));
  }

  // 2. Find open conversation or create one
  console.log(c.dim('→ Finding/creating conversation...'));
  const { data: existingConv } = await db
    .from('conversations')
    .select('*')
    .eq('organization_id', orgId)
    .eq('contact_id', contact.id)
    .in('status', ['open', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversation = existingConv;
  if (!conversation) {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({
        organization_id: orgId,
        contact_id: contact.id,
        channel: 'sms',
        status: 'open',
        subject: message.slice(0, 80),
      })
      .select()
      .single();

    if (convErr) {
      console.error(c.red(`  ✗ Failed to create conversation: ${convErr.message}`));
      process.exit(1);
    }
    conversation = newConv;
    console.log(c.green(`  ✓ Created conversation: ${conversation.id}`));
  } else {
    console.log(c.dim(`  • Existing conversation: ${conversation.id}`));
  }

  // 3. Create message
  console.log(c.dim('→ Creating message...'));
  const { data: msg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'contact',
      sender_id: contact.id,
      direction: 'inbound',
      channel: 'sms',
      body: message,
      external_message_id: externalMessageId,
      delivery_status: 'delivered',
      provider: 'mock',
      raw_payload: { from: FROM_NUMBER, to: TO_NUMBER, messageId: externalMessageId },
    })
    .select()
    .single();

  if (msgErr) {
    console.error(c.red(`  ✗ Failed to create message: ${msgErr.message}`));
    process.exit(1);
  }
  console.log(c.green(`  ✓ Created message: ${msg.id}`));

  // 4. Update conversation last_message_at
  await db
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), status: 'open' })
    .eq('id', conversation.id);

  // 5. Enqueue AI processing job
  console.log(c.dim('→ Enqueuing AI job...'));
  const { error: jobErr } = await db
    .from('support_jobs')
    .insert({
      organization_id: orgId,
      job_type: 'process_ai_message',
      payload: {
        messageId: msg.id,
        conversationId: conversation.id,
        contactId: contact.id,
      },
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    });

  if (jobErr) {
    console.log(c.yellow(`  ⚠ AI job enqueue failed: ${jobErr.message}`));
  } else {
    console.log(c.green('  ✓ AI job enqueued'));

    // 6. Trigger process-jobs to run AI immediately
    console.log(c.dim('→ Triggering AI processing...'));
    try {
      const processRes = await fetch(`${BASE_URL.replace('.us-east.insforge.app', '.functions.insforge.app')}/process-jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: '{}',
      });
      const processResult = await readJsonOrFallback(processRes, null, 'process-jobs trigger');
      if (processRes.ok && processResult?.claimed > 0) {
        console.log(c.green(`  ✓ AI processed: ${JSON.stringify(processResult.results?.[0]?.status || 'done')}`));
      } else if (processRes.ok) {
        console.log(c.dim('  • No jobs claimed (may already be processed)'));
      } else {
        console.log(c.yellow(`  ⚠ AI trigger returned ${processRes.status}: ${processResult?.error || 'unknown'}`));
      }
    } catch (triggerErr) {
      console.log(c.yellow(`  ⚠ Could not trigger process-jobs: ${triggerErr.message}`));
    }
  }

  // Summary
  console.log('');
  console.log(c.green('━'.repeat(60)));
  console.log(c.green('  ✓ Inbound SMS processed successfully'));
  console.log(c.green('━'.repeat(60)));
  console.log('');
  console.log(JSON.stringify({
    messageId: msg.id,
    conversationId: conversation.id,
    contactId: contact.id,
    organizationId: orgId,
  }, null, 2));

  return { messageId: msg.id, conversationId: conversation.id, contactId: contact.id };
}

async function cmdStatus(externalMessageId, deliveryStatus = 'delivered') {
  if (!externalMessageId) {
    console.error(c.red('Usage: node scripts/mock-sms.mjs status <externalMessageId> [status]'));
    console.log('  status: queued | sent | delivered | failed | bounced (default: delivered)');
    process.exit(1);
  }

  printHeader('Simulating Delivery Status Update');
  console.log(`${c.yellow('ExtMsgID:')}   ${externalMessageId}`);
  console.log(`${c.yellow('Status:')}     ${deliveryStatus}`);
  console.log('');

  // Find message
  const { data: msg, error: findErr } = await db
    .from('messages')
    .select('id, delivery_status')
    .eq('external_message_id', externalMessageId)
    .limit(1)
    .maybeSingle();

  if (findErr || !msg) {
    console.log(c.red('  ✗ Message not found with that external_message_id'));
    if (findErr) console.log(c.red(`    ${findErr.message}`));
    return;
  }

  // Update
  const { error: updateErr } = await db
    .from('messages')
    .update({ delivery_status: deliveryStatus, updated_at: new Date().toISOString() })
    .eq('id', msg.id);

  if (updateErr) {
    console.log(c.red(`  ✗ Update failed: ${updateErr.message}`));
    return;
  }

  console.log(c.green(`  ✓ Message ${msg.id} status: ${msg.delivery_status} → ${deliveryStatus}`));
}

async function cmdReply(conversationId, message = "Thanks for reaching out! We're looking into this now.") {
  if (!conversationId) {
    console.error(c.red('Usage: node scripts/mock-sms.mjs reply <conversationId> [body]'));
    process.exit(1);
  }

  const orgId = await resolveOrgId();

  printHeader('Sending Reply (Mock Outbound SMS)');
  console.log(`${c.yellow('Conversation:')}  ${conversationId}`);
  console.log(`${c.yellow('Body:')}          ${message}`);
  console.log('');

  // Get conversation to find the contact
  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .select('id, contact_id, channel')
    .eq('id', conversationId)
    .single();

  if (convErr || !conversation) {
    console.error(c.red(`  ✗ Conversation not found: ${convErr?.message || 'not found'}`));
    process.exit(1);
  }

  // Get contact phone
  const { data: contact } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', conversation.contact_id)
    .single();

  // Create outbound message
  const externalMessageId = `mock_sms_${Date.now()}`;
  const { data: msg, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'user',
      sender_id: null,
      direction: 'outbound',
      channel: 'sms',
      body: message,
      external_message_id: externalMessageId,
      delivery_status: 'queued',
      provider: 'mock',
      raw_payload: { from: TO_NUMBER, to: contact?.phone || FROM_NUMBER },
    })
    .select()
    .single();

  if (msgErr) {
    console.error(c.red(`  ✗ Failed to create message: ${msgErr.message}`));
    process.exit(1);
  }

  // Update conversation
  await db
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  console.log(c.green('  ✓ Reply sent (mock — not actually delivered)'));
  console.log('');
  console.log(JSON.stringify({
    messageId: msg.id,
    externalMessageId,
    to: contact?.phone || FROM_NUMBER,
    deliveryStatus: 'queued',
  }, null, 2));
  console.log('');
  console.log(c.dim('Simulate delivery:'));
  console.log(c.cyan(`  node scripts/mock-sms.mjs status ${externalMessageId} delivered`));
}

async function cmdConversation(message = 'Hey, I have a question about billing') {
  const result = await cmdInbound(message);
  console.log('');
  console.log(c.cyan('Next steps:'));
  console.log(c.green(`  node scripts/mock-sms.mjs reply ${result.conversationId} "Got it, looking into this"`));
  console.log(c.green(`  node scripts/mock-sms.mjs inbound "Thanks, any update?"  # customer follows up`));
}

function cmdHelp() {
  console.log(`
${c.bold('InboxPilot — Mock SMS Development Script')}

${c.cyan('Usage:')}
  node scripts/mock-sms.mjs <command> [args...]

${c.cyan('Commands:')}
  inbound [message]                Simulate a customer sending an SMS
  status <messageId> [status]      Simulate a delivery status update
  reply <conversationId> [body]    Send a reply (mock outbound)
  conversation [message]           Inbound + show next steps
  help                             Show this help

${c.cyan('Examples:')}
  # Customer sends a message
  node scripts/mock-sms.mjs inbound "Where is my order?"

  # Full conversation flow
  node scripts/mock-sms.mjs conversation "I need a refund"
  node scripts/mock-sms.mjs reply <conversationId> "I'll process that for you"

  # Simulate delivery confirmation
  node scripts/mock-sms.mjs status mock_sms_1717000000000 delivered

${c.cyan('Environment Variables (auto-loaded from .env.local):')}
  ORG_ID        Override organization UUID
  FROM_NUMBER   Customer phone (default: +15551234567)
  TO_NUMBER     App phone number (default: +15559876543)

${c.cyan('How it works:')}
  Uses the @insforge/sdk with the service role key to bypass RLS
  and directly create contacts, conversations, and messages — same
  data the edge functions would produce. Open the inbox UI at
  localhost:3000/inbox to see messages appear in real time.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

checkConfig();

const [command, ...args] = process.argv.slice(2);

switch (command || 'help') {
  case 'inbound':
    await cmdInbound(args[0]);
    break;
  case 'status':
    await cmdStatus(args[0], args[1]);
    break;
  case 'reply':
    await cmdReply(args[0], args[1]);
    break;
  case 'conversation':
    await cmdConversation(args[0]);
    break;
  case 'help':
  case '--help':
  case '-h':
    cmdHelp();
    break;
  default:
    console.error(c.red(`Unknown command: ${command}`));
    cmdHelp();
    process.exit(1);
}
