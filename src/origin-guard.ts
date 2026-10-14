/**
 * Browser CSRF guard shared by the API routes. Requests that carry an Origin
 * header must match the configured allow-list
 * (ADMIN_AGENT_ALLOWED_ORIGINS). Non-browser clients (tests, scripts, server
 * calls) send no Origin header and pass through; write endpoints are still
 * gated separately by preview + confirmation checks.
 */
export function isOriginAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): boolean {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins.includes(origin);
}
