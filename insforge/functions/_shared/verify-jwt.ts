/**
 * Shared utility: verifies JWT authentication for function entrypoints.
 *
 * Extracts the Bearer token from the Authorization header, calls the InsForge
 * auth endpoint to verify the token and retrieve the user, and returns the
 * user ID (the `sub` claim) or null if the token is invalid.
 *
 * Used by JWT-authenticated functions: send-reply, approve-ai-draft,
 * regenerate-ai-draft, escalate-conversation, resolve-conversation,
 * reopen-conversation, test-channel-connection.
 */

export interface VerifiedUser {
  /** The user ID from the JWT `sub` claim. */
  userId: string;
}

/**
 * Verify a JWT token from the Authorization header.
 *
 * @param req - The incoming Request object
 * @param baseUrl - InsForge project base URL
 * @param serviceRoleKey - InsForge service role key (used as apikey header)
 * @returns The verified user info, or null if the token is invalid/missing
 */
export async function verifyJwt(
  req: Request,
  baseUrl: string,
  serviceRoleKey: string,
): Promise<VerifiedUser | null> {
  // 1. Extract the Bearer token from the Authorization header
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  const token = parts[1];
  if (!token) {
    return null;
  }

  try {
    // 2. Call the InsForge auth endpoint to verify the token and get the user
    const res = await fetch(`${baseUrl}/api/auth/sessions/current`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const user = (data.user as Record<string, unknown>) ?? data;

    // 3. Extract the user ID from the response
    const userId = (user.id as string) ?? (user.sub as string);
    if (!userId || typeof userId !== 'string') {
      return null;
    }

    return { userId };
  } catch {
    // Network errors, JSON parse errors, etc.
    return null;
  }
}
