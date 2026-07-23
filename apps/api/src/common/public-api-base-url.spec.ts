import { afterEach, describe, expect, it } from 'vitest';
import { resolvePublicApiBaseUrl } from './public-api-base-url';

describe('resolvePublicApiBaseUrl', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env.PUBLIC_API_BASE_URL = original.PUBLIC_API_BASE_URL;
    process.env.FLOWX_PUBLIC_API_BASE_URL = original.FLOWX_PUBLIC_API_BASE_URL;
    process.env.PORT = original.PORT;
    if (original.PUBLIC_API_BASE_URL === undefined) delete process.env.PUBLIC_API_BASE_URL;
    if (original.FLOWX_PUBLIC_API_BASE_URL === undefined) {
      delete process.env.FLOWX_PUBLIC_API_BASE_URL;
    }
    if (original.PORT === undefined) delete process.env.PORT;
  });

  it('uses PUBLIC_API_BASE_URL when set', () => {
    expect(
      resolvePublicApiBaseUrl({
        PUBLIC_API_BASE_URL: 'https://flowx.example.com/api/',
        PORT: '3000',
      }),
    ).toBe('https://flowx.example.com/api');
  });

  it('falls back to FLOWX_PUBLIC_API_BASE_URL', () => {
    expect(
      resolvePublicApiBaseUrl({
        FLOWX_PUBLIC_API_BASE_URL: 'https://flowx.example.com',
      }),
    ).toBe('https://flowx.example.com');
  });

  it('falls back to loopback for local development', () => {
    expect(resolvePublicApiBaseUrl({ PORT: '3001' })).toBe('http://127.0.0.1:3001');
  });
});
