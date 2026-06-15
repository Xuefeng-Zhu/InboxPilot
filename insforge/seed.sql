-- seed.sql
-- Idempotent seed data for InboxPilot AI Customer Support Platform
-- Run multiple times safely — uses INSERT ... ON CONFLICT DO NOTHING with fixed UUIDs.
--
-- Creates:
--   1 organization (Acme Support)
--   1 owner member
--   3 contacts
--   5 conversations (SMS + email, various statuses)
--   10 messages (varied sender_types and directions)
--   2 knowledge documents with chunks and placeholder embeddings
--   1 AI settings record

-- =============================================================================
-- 1. Organization
-- =============================================================================

INSERT INTO organizations (id, name, slug, metadata)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Acme Support',
  'acme-support',
  '{"plan": "pro", "industry": "saas"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. Owner Member
-- =============================================================================

INSERT INTO organization_members (id, organization_id, user_id, role)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'usr_seed_owner_001',
  'owner'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 3. Contacts (3)
-- =============================================================================

INSERT INTO contacts (id, organization_id, name, email, phone)
VALUES
  (
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Alice Johnson',
    'alice@example.com',
    '+14155550101'
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'Bob Smith',
    'bob.smith@example.com',
    '+14155550102'
  ),
  (
    'c0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'Carol Davis',
    'carol.davis@example.com',
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. Conversations (5) — mix of SMS and email, various statuses
-- =============================================================================

INSERT INTO conversations (id, organization_id, contact_id, channel, status, ai_state, subject, last_message_at)
VALUES
  -- Conv 1: Alice, SMS, open, AI drafted a reply
  (
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'sms',
    'open',
    'drafted',
    NULL,
    '2025-01-15 10:30:00+00'
  ),
  -- Conv 2: Bob, email, escalated, needs human
  (
    'd0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'email',
    'escalated',
    'needs_human',
    'Billing dispute — order #9042',
    '2025-01-15 11:00:00+00'
  ),
  -- Conv 3: Carol, email, open, idle (waiting for AI)
  (
    'd0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000003',
    'email',
    'open',
    'idle',
    'How do I reset my password?',
    '2025-01-15 09:15:00+00'
  ),
  -- Conv 4: Alice, email, resolved, idle
  (
    'd0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'email',
    'resolved',
    'idle',
    'Feature request — dark mode',
    '2025-01-14 16:45:00+00'
  ),
  -- Conv 5: Bob, SMS, open, auto_replied
  (
    'd0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'sms',
    'open',
    'auto_replied',
    NULL,
    '2025-01-15 12:20:00+00'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 5. Messages (10) — varied sender_types and directions
-- =============================================================================

INSERT INTO messages (id, conversation_id, sender_type, sender_id, direction, channel, body, subject, delivery_status)
VALUES
  -- Conv 1 (Alice SMS): inbound from contact, then AI draft outbound
  (
    'e0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'contact',
    NULL,
    'inbound',
    'sms',
    'Hi, I need help with my account login. It keeps saying invalid password.',
    NULL,
    'delivered'
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    'ai',
    NULL,
    'outbound',
    'sms',
    'Hello! I can help you reset your password. Please visit our password reset page at https://acme.example.com/reset. Let me know if you need further assistance.',
    NULL,
    'pending'
  ),

  -- Conv 2 (Bob email): inbound from contact, then system escalation note
  (
    'e0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000002',
    'contact',
    NULL,
    'inbound',
    'email',
    'I was charged twice for order #9042. I want a refund immediately or I will dispute this with my bank.',
    'Billing dispute — order #9042',
    'delivered'
  ),
  (
    'e0000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000002',
    'system',
    NULL,
    'outbound',
    'email',
    'This conversation has been escalated to a human agent due to: sensitive topic (billing dispute, refund request).',
    NULL,
    'delivered'
  ),

  -- Conv 3 (Carol email): inbound from contact
  (
    'e0000000-0000-4000-8000-000000000005',
    'd0000000-0000-4000-8000-000000000003',
    'contact',
    NULL,
    'inbound',
    'email',
    'How do I reset my password? I tried the forgot password link but never received an email.',
    'How do I reset my password?',
    'delivered'
  ),

  -- Conv 4 (Alice email): inbound, agent reply, resolved
  (
    'e0000000-0000-4000-8000-000000000006',
    'd0000000-0000-4000-8000-000000000004',
    'contact',
    NULL,
    'inbound',
    'email',
    'It would be great if you could add a dark mode option to the dashboard.',
    'Feature request — dark mode',
    'delivered'
  ),
  (
    'e0000000-0000-4000-8000-000000000007',
    'd0000000-0000-4000-8000-000000000004',
    'user',
    'usr_seed_owner_001',
    'outbound',
    'email',
    'Thanks for the suggestion, Alice! We have added dark mode to our roadmap. Stay tuned for updates.',
    'Re: Feature request — dark mode',
    'delivered'
  ),

  -- Conv 5 (Bob SMS): inbound, AI auto-replied, contact follow-up
  (
    'e0000000-0000-4000-8000-000000000008',
    'd0000000-0000-4000-8000-000000000005',
    'contact',
    NULL,
    'inbound',
    'sms',
    'What are your support hours?',
    NULL,
    'delivered'
  ),
  (
    'e0000000-0000-4000-8000-000000000009',
    'd0000000-0000-4000-8000-000000000005',
    'ai',
    NULL,
    'outbound',
    'sms',
    'Our support team is available Monday through Friday, 9 AM to 6 PM EST. You can also reach us anytime via email at support@acme.example.com.',
    NULL,
    'delivered'
  ),
  (
    'e0000000-0000-4000-8000-000000000010',
    'd0000000-0000-4000-8000-000000000005',
    'contact',
    NULL,
    'inbound',
    'sms',
    'Great, thanks!',
    NULL,
    'delivered'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 6. Knowledge Documents (2) with chunks and placeholder embeddings
-- =============================================================================

-- Document 1: FAQ
INSERT INTO knowledge_documents (id, organization_id, title, source_type, body, status)
VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Frequently Asked Questions',
  'faq',
  E'Q: How do I reset my password?\nA: Visit https://acme.example.com/reset, enter your email, and follow the instructions sent to your inbox. If you do not receive the email within 5 minutes, check your spam folder or contact support.\n\nQ: What are your support hours?\nA: Our support team is available Monday through Friday, 9 AM to 6 PM EST. Email support is monitored outside these hours with a 24-hour response guarantee.\n\nQ: How do I cancel my subscription?\nA: Navigate to Settings > Billing > Cancel Subscription. Your access continues until the end of the current billing period. Refunds are handled on a case-by-case basis.',
  'ready'
)
ON CONFLICT (id) DO NOTHING;

-- Document 2: Product Info
INSERT INTO knowledge_documents (id, organization_id, title, source_type, body, status)
VALUES (
  'f0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'Product Overview — Acme Platform',
  'product_info',
  E'Acme Platform is a SaaS tool for team collaboration and project management. Key features include:\n- Real-time task boards with drag-and-drop\n- Integrated chat and video calls\n- File sharing with version history\n- Customizable workflows and automations\n- Role-based access control\n\nPricing: Starter ($9/user/mo), Pro ($19/user/mo), Enterprise (custom). All plans include a 14-day free trial.',
  'ready'
)
ON CONFLICT (id) DO NOTHING;

-- Chunks for Document 1 (FAQ) — 2 chunks
-- Using a 1536-dimension zero vector as a placeholder embedding.
-- In production, real embeddings would be generated by the AI gateway.

INSERT INTO knowledge_chunks (id, document_id, organization_id, content, embedding, metadata)
VALUES
  (
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Q: How do I reset my password? A: Visit https://acme.example.com/reset, enter your email, and follow the instructions sent to your inbox. If you do not receive the email within 5 minutes, check your spam folder or contact support.',
    (SELECT ('[' || array_to_string(array_agg(0), ',') || ']') FROM generate_series(1, 1536))::vector,
    '{"chunk_index": 0, "source": "faq"}'::jsonb
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'f0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Q: What are your support hours? A: Our support team is available Monday through Friday, 9 AM to 6 PM EST. Email support is monitored outside these hours with a 24-hour response guarantee. Q: How do I cancel my subscription? A: Navigate to Settings > Billing > Cancel Subscription. Your access continues until the end of the current billing period.',
    (SELECT ('[' || array_to_string(array_agg(0), ',') || ']') FROM generate_series(1, 1536))::vector,
    '{"chunk_index": 1, "source": "faq"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- Chunks for Document 2 (Product Info) — 2 chunks

INSERT INTO knowledge_chunks (id, document_id, organization_id, content, embedding, metadata)
VALUES
  (
    'f1000000-0000-4000-8000-000000000003',
    'f0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'Acme Platform is a SaaS tool for team collaboration and project management. Key features include: Real-time task boards with drag-and-drop, Integrated chat and video calls, File sharing with version history, Customizable workflows and automations, Role-based access control.',
    (SELECT ('[' || array_to_string(array_agg(0), ',') || ']') FROM generate_series(1, 1536))::vector,
    '{"chunk_index": 0, "source": "product_info"}'::jsonb
  ),
  (
    'f1000000-0000-4000-8000-000000000004',
    'f0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'Pricing: Starter ($9/user/mo), Pro ($19/user/mo), Enterprise (custom). All plans include a 14-day free trial.',
    (SELECT ('[' || array_to_string(array_agg(0), ',') || ']') FROM generate_series(1, 1536))::vector,
    '{"chunk_index": 1, "source": "product_info"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 7. AI Settings
-- =============================================================================

INSERT INTO ai_settings (id, organization_id, ai_mode, confidence_threshold, context_window_size, max_consecutive_failures, knowledge_similarity_threshold, escalation_keywords, system_prompt, model, embedding_model)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'draft_only',
  0.75,
  20,
  3,
  0.70,
  ARRAY['urgent', 'lawsuit', 'attorney', 'legal'],
  'You are a helpful customer support assistant for Acme Platform. Answer questions using the provided knowledge base context. Be concise, friendly, and professional. If you are unsure, say so and offer to connect the customer with a human agent.',
  'openai/gpt-4o-mini',
  'openai/text-embedding-3-small'
)
ON CONFLICT (id) DO NOTHING;
