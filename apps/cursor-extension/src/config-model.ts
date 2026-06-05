export interface FlowXConfig {
  apiBaseUrl: string;
  apiToken: string;
}

export interface FlowXAuthOrganization {
  id: string;
  name: string;
}

export type FlowXAuthCallback =
  | { type: 'token'; token: string }
  | { type: 'organization-selection'; selectionToken: string; organizations: FlowXAuthOrganization[] }
  | { type: 'error'; message: string };

export function normalizeApiBaseUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    url.port = '3000';
    url.pathname = '';
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function buildFlowXLoginUrl(input: { apiBaseUrl: string; callbackUrl: string }): string {
  const url = buildFlowXApiUrl(input.apiBaseUrl, '/auth/dingtalk/login');
  url.searchParams.set('callbackUrl', input.callbackUrl);
  url.searchParams.set('next', '/requirements');
  return url.toString();
}

export function buildFlowXApiUrl(apiBaseUrl: string, path: string): URL {
  const base = new URL(apiBaseUrl);
  const basePath = base.pathname.replace(/\/$/, '');
  const nextPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${basePath}${nextPath}`;
  base.search = '';
  base.hash = '';
  return base;
}

export function buildFlowXWebUrl(apiBaseUrl: string, path: string, env: Record<string, string | undefined> = {}): string {
  const webBaseUrl = env.FLOWX_WEB_BASE_URL?.trim();
  const url = new URL(path, webBaseUrl || apiBaseUrl);
  if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '3000') {
    url.port = '5173';
  }
  return url.toString();
}

export function buildCursorAuthCallbackUri(uriScheme: string, extensionId: string): string {
  return `${uriScheme}://${extensionId}/auth-callback`;
}

export function parseFlowXAuthCallback(query: string): FlowXAuthCallback {
  const params = new URLSearchParams(query);
  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    return { type: 'error', message: error };
  }

  const token = params.get('token');
  if (token) {
    return { type: 'token', token };
  }

  const selectionToken = params.get('selectionToken');
  const organizationsParam = params.get('organizations');
  if (selectionToken && organizationsParam) {
    return {
      type: 'organization-selection',
      selectionToken,
      organizations: JSON.parse(decodeURIComponent(organizationsParam)) as FlowXAuthOrganization[],
    };
  }

  return { type: 'error', message: 'FlowX sign-in did not return a token.' };
}
