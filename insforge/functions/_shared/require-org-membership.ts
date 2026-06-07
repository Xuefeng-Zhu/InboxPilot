/**
 * requireOrgMembership — cross-tenant authorization guard for JWT-protected
 * function entrypoints that mutate a conversation.
 *
 * Background (CRITICAL-2, docs/QA_BUG_HUNT.md): the seven JWT-authenticated
 * serverless function entrypoints used to (1) verify the JWT, (2) load a
 * conversation by `conversationId` from the request body, and (3) mutate it
 * through a service-role-key DatabaseClient that bypasses RLS. There was no
 * check that the caller belonged to the org that owned the conversation, so
 * any authenticated user in any tenant could call e.g. `send-reply` with
 * another tenant's `conversationId` and trigger real outbound SMS/email
 * (cost + brand risk) or write an audit log entry on a conversation they
 * did not own.
 *
 * This helper closes that hole. It loads the conversation, then verifies
 * the user is a member of its organization. The call site must map the
 * discriminated result to the correct HTTP status code:
 *
 *   { kind: 'ok', organizationId }   → continue with the mutation
 *   { kind: 'conversation_not_found' } → 404
 *   { kind: 'forbidden' }              → 403
 *
 * The helper does NOT import the InsForge SDK or the verify-jwt utility;
 * it only needs a DatabaseClient and the userId from a previous JWT check.
 *
 * IMPORTANT: callers MUST have already verified the user's JWT before
 * calling this helper. This helper assumes `userId` is trusted.
 */

import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { MemberRepository } from '../../../packages/support-core/src/repositories/member-repository.js';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.js';

/** Result of a cross-tenant membership check. */
export type OrgMembershipResult =
  /** Caller is a member of the org that owns the conversation. */
  | { kind: 'ok'; organizationId: string }
  /** The conversation does not exist (or caller had no way to know it did). */
  | { kind: 'conversation_not_found' }
  /** The conversation exists but the caller is not a member of its org. */
  | { kind: 'forbidden' };

/**
 * Verify that the given user belongs to the org that owns the given
 * conversation. Returns a discriminated result the caller must map to an
 * HTTP response — this helper never throws on authorization failures
 * (it may still throw on infrastructure errors from the DB).
 *
 * @param db - DatabaseClient (typically service-role-key backed in functions)
 * @param userId - The verified JWT subject (the caller's user id)
 * @param conversationId - The conversation the caller wants to mutate
 * @returns A discriminated result indicating ok / not-found / forbidden
 */
export async function requireOrgMembership(
  db: DatabaseClient,
  userId: string,
  conversationId: string,
): Promise<OrgMembershipResult> {
  const conversationRepo = new ConversationRepository(db);
  const memberRepo = new MemberRepository(db);

  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    return { kind: 'conversation_not_found' };
  }

  const membership = await memberRepo.findByOrgAndUser(conversation.organizationId, userId);
  if (!membership) {
    return { kind: 'forbidden' };
  }

  return { kind: 'ok', organizationId: conversation.organizationId };
}
