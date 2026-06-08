/**
 * Shared CORS utility for webchat Deno functions.
 *
 * All webchat endpoints are called cross-origin from the customer's site.
 * This helper adds the proper CORS headers and handles OPTIONS preflight.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-widget-token',
  'Access-Control-Max-Age': '86400',
};

/**
 * Returns a 204 response for CORS preflight requests.
 */
export function handleCorsPreFlight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Create a JSON response with CORS headers attached.
 */
export function corsJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
