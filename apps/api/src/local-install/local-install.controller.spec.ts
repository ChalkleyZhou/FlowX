import { afterEach, describe, expect, it } from 'vitest';
import { LocalInstallController } from './local-install.controller';

describe('LocalInstallController', () => {
  const original = {
    PUBLIC_API_BASE_URL: process.env.PUBLIC_API_BASE_URL,
    FLOWX_PUBLIC_API_BASE_URL: process.env.FLOWX_PUBLIC_API_BASE_URL,
  };

  afterEach(() => {
    if (original.PUBLIC_API_BASE_URL === undefined) {
      delete process.env.PUBLIC_API_BASE_URL;
    } else {
      process.env.PUBLIC_API_BASE_URL = original.PUBLIC_API_BASE_URL;
    }
    if (original.FLOWX_PUBLIC_API_BASE_URL === undefined) {
      delete process.env.FLOWX_PUBLIC_API_BASE_URL;
    } else {
      process.env.FLOWX_PUBLIC_API_BASE_URL = original.FLOWX_PUBLIC_API_BASE_URL;
    }
  });

  it('无需 Bearer，按转发头生成嵌入站点 API 的安装脚本', () => {
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.FLOWX_PUBLIC_API_BASE_URL;

    const controller = new LocalInstallController();
    const body = controller.install({
      headers: {
        Host: 'flowx.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(body).toContain('nodejs.org');
    expect(body).toContain('https://flowx.example.com/api');
  });

  it('serves a PowerShell installer at GET /install.ps1', () => {
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.FLOWX_PUBLIC_API_BASE_URL;

    const controller = new LocalInstallController();
    const body = controller.installPs1({
      headers: {
        Host: 'flowx.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(body).toContain('$ErrorActionPreference');
    expect(body).toContain('https://flowx.example.com/api');
    expect(body).toContain('irm https://flowx.example.com/install.ps1 | iex');
  });

  it('declares Content-Disposition inline on GET /install', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      LocalInstallController.prototype.install,
    ) as Array<{ name: string; value: string }> | undefined;
    expect(headers).toEqual(
      expect.arrayContaining([{ name: 'Content-Disposition', value: 'inline' }]),
    );
  });
});
