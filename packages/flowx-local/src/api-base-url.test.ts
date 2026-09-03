import { describe, expect, it } from 'vitest';
import {
  isConfirmedApiBaseUrl,
  isPlaceholderApiBaseUrl,
  normalizeApiBaseUrl,
  resolveApiBaseUrl,
} from './api-base-url.js';

describe('api-base-url', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeApiBaseUrl(' https://flowx.example/api/ ')).toBe('https://flowx.example/api');
  });

  it('treats historical localhost:3000 as placeholder', () => {
    expect(isPlaceholderApiBaseUrl('http://127.0.0.1:3000/')).toBe(true);
    expect(isPlaceholderApiBaseUrl('http://localhost:3000')).toBe(true);
    expect(isPlaceholderApiBaseUrl('https://flowx.example/api')).toBe(false);
  });

  it('does not treat empty as confirmed', () => {
    expect(isConfirmedApiBaseUrl('')).toBe(false);
    expect(isConfirmedApiBaseUrl('http://127.0.0.1:3000')).toBe(false);
    expect(isConfirmedApiBaseUrl('https://flowx.example/api')).toBe(true);
  });

  it('prefers explicit flag even when it is loopback', () => {
    expect(
      resolveApiBaseUrl({
        flag: 'http://127.0.0.1:3000',
        env: 'https://ignored',
        config: 'https://also-ignored',
      }),
    ).toEqual({ url: 'http://127.0.0.1:3000', source: 'flag' });
  });

  it('uses env then confirmed config, and treats placeholder config as missing', () => {
    expect(
      resolveApiBaseUrl({ env: 'https://from.env/api/', config: 'http://127.0.0.1:3000' }),
    ).toEqual({ url: 'https://from.env/api', source: 'env' });
    expect(resolveApiBaseUrl({ config: 'http://127.0.0.1:3000' })).toEqual({
      url: null,
      source: 'missing',
    });
    expect(resolveApiBaseUrl({ config: 'https://flowx.example/api' })).toEqual({
      url: 'https://flowx.example/api',
      source: 'config',
    });
  });
});
