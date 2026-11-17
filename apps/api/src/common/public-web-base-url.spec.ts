import { describe, expect, it } from 'vitest';
import { resolvePublicWebBaseUrl } from './public-web-base-url';

describe('resolvePublicWebBaseUrl', () => {
  it('读取 FLOWX_WEB_BASE_URL 并去除末尾斜杠', () => {
    expect(resolvePublicWebBaseUrl({
      FLOWX_WEB_BASE_URL: ' https://flowx.example.com/// ',
    })).toBe('https://flowx.example.com');
  });

  it('未配置时返回 null，避免生成 localhost 链接', () => {
    expect(resolvePublicWebBaseUrl({})).toBeNull();
  });
});
