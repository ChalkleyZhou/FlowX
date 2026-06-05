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
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function buildFlowXLoginUrl(input: { apiBaseUrl: string; callbackUrl: string }): string {
  const url = new URL('/auth/dingtalk/login', input.apiBaseUrl);
  url.searchParams.set('callbackUrl', input.callbackUrl);
  url.searchParams.set('next', '/requirements');
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
