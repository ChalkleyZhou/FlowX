/**
 * Absolute API base URL for edge agents / MCP on developer machines.
 * Prefer PUBLIC_API_BASE_URL (or FLOWX_PUBLIC_API_BASE_URL) in deployed environments.
 * Falls back to loopback only for local development.
 */
export function resolvePublicApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    env.PUBLIC_API_BASE_URL?.trim() || env.FLOWX_PUBLIC_API_BASE_URL?.trim() || '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const port = env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}`;
}
