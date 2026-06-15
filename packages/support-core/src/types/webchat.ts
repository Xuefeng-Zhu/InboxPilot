/**
 * Webchat domain — widgets and visitor threads.
 *
 * Webchat is its own sub-ecosystem distinct from SMS/email: widgets hold
 * tenant-level configuration (token, allowed domains, position, greeting),
 * threads bind a visitor's anonymous session to a conversation. These types
 * are paired 1:1 with `webchat_widgets` and `webchat_threads` tables.
 */

import type { AiMode } from './enums';

// ─── Entities ────────────────────────────────────────────────────────

export type WebchatWidgetPosition = 'bottom-right' | 'bottom-left';

export interface WebchatWidget {
  id: string;
  organizationId: string;
  name: string;
  widgetToken: string;
  hmacSecret: string;
  allowedDomains: string[];
  position: WebchatWidgetPosition;
  primaryColor: string | null;
  greeting: string | null;
  preChatEnabled: boolean;
  aiModeOverride: AiMode | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebchatThread {
  id: string;
  organizationId: string;
  widgetId: string;
  conversationId: string;
  contactId: string;
  visitorTokenJti: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  identifiedAt: Date | null;
  pageUrl: string | null;
  referrer: string | null;
  userAgent: string | null;
  ipCountry: string | null;
  ipCity: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Create / Update inputs ──────────────────────────────────────────

export interface CreateWebchatWidgetInput {
  organizationId: string;
  name: string;
  widgetToken: string;
  hmacSecret: string;
  allowedDomains?: string[];
  position?: WebchatWidgetPosition;
  primaryColor?: string | null;
  greeting?: string | null;
  preChatEnabled?: boolean;
  aiModeOverride?: AiMode | null;
}

export interface UpdateWebchatWidgetInput {
  name?: string;
  allowedDomains?: string[];
  position?: WebchatWidgetPosition;
  primaryColor?: string | null;
  greeting?: string | null;
  preChatEnabled?: boolean;
  aiModeOverride?: AiMode | null;
  isActive?: boolean;
}

export interface CreateWebchatThreadInput {
  organizationId: string;
  widgetId: string;
  conversationId: string;
  contactId: string;
  visitorTokenJti: string;
  pageUrl?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ipCountry?: string | null;
  ipCity?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateWebchatThreadInput {
  lastSeenAt?: Date;
  identifiedAt?: Date | null;
  pageUrl?: string | null;
  visitorTokenJti?: string;
  metadata?: Record<string, unknown>;
}
