import { describe, expect, it } from 'vitest';
import { resolvePublicWebBaseUrl } from './public-web-base-url';

describe('resolvePublicWebBaseUrl', () => {
  it('优先读取 FLOWX_PUBLIC_WEB_URL 并去除末尾斜杠', () => {
    expect(resolvePublicWebBaseUrl({
      FLOWX_PUBLIC_WEB_URL: ' https://flowx.example.com/// ',
      PUBLIC_WEB_URL: 'https://fallback.example.com',
    })).toBe('https://flowx.example.com');
  });

  it('未配置时返回 null，避免生成 localhost 链接', () => {
    expect(resolvePublicWebBaseUrl({})).toBeNull();
  });
});
