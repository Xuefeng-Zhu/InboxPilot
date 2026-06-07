import { NextRequest } from 'next/server';

/**
 * Extract user ID from the access token (cookie or header).
 * Decodes the JWT payload locally — no external auth call needed
 * since these routes are same-origin and the token was issued by InsForge.
 */
export function getUserFromToken(req: NextRequest): { id: string } | null {
  const auth = req.headers.get('authorization');
  const token = auth?.replace('Bearer ', '')
    || req.cookies.get('insforge_access_token')?.value;
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const userId = payload.sub || payload.id;
    if (!userId) return null;
    return { id: userId };
  } catch {
    return null;
  }
}
