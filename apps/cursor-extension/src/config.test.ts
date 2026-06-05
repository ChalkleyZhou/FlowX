import { describe, expect, it } from 'vitest';
import {
  buildCursorAuthCallbackUri,
  buildFlowXLoginUrl,
  normalizeApiBaseUrl,
  parseFlowXAuthCallback,
} from './config-model';

describe('normalizeApiBaseUrl', () => {
  it('normalizes web and api urls to the API origin', () => {
    expect(normalizeApiBaseUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:3000');
    expect(normalizeApiBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
  });
});

describe('parseFlowXAuthCallback', () => {
  it('parses token callbacks', () => {
    expect(parseFlowXAuthCallback('token=token-1')).toEqual({ type: 'token', token: 'token-1' });
  });

  it('parses organization selection callbacks', () => {
    const organizations = encodeURIComponent(JSON.stringify([{ id: 'org-1', name: 'FlowX Org' }]));
    expect(parseFlowXAuthCallback(`selectionToken=select-1&organizations=${encodeURIComponent(organizations)}`)).toEqual({
      type: 'organization-selection',
      selectionToken: 'select-1',
      organizations: [{ id: 'org-1', name: 'FlowX Org' }],
    });
  });
});

describe('buildFlowXLoginUrl', () => {
  it('builds a Cursor URI handler callback for the extension id', () => {
    expect(buildCursorAuthCallbackUri('cursor', 'flowx.flowx-cursor-extension')).toBe(
      'cursor://flowx.flowx-cursor-extension/auth-callback',
    );
  });

  it('builds DingTalk login url with Cursor callback', () => {
    expect(
      buildFlowXLoginUrl({
        apiBaseUrl: 'http://127.0.0.1:3000',
        callbackUrl: 'cursor://flowx.flowx-cursor-extension/callback',
      }),
    ).toBe(
      'http://127.0.0.1:3000/auth/dingtalk/login?callbackUrl=cursor%3A%2F%2Fflowx.flowx-cursor-extension%2Fcallback&next=%2Frequirements',
    );
  });
});
