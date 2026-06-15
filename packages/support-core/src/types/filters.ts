/**
 * Query / filter shapes for repository reads.
 *
 * These are passed to repository `find*` methods to narrow what the database
 * returns. Fields are all optional; an empty filter typically means "all
 * rows for the current org" (the org scope itself is enforced by RLS and the
 * `organizationId` argument, not by this filter object).
 */

import type { Channel, ConversationStatus } from './enums';

export interface ConversationFilters {
  status?: ConversationStatus;
  channel?: Channel;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}
