import { describe, expect, it } from 'vitest';
import {
  buildInstallScript,
  requestPublicOrigin,
  resolveInstallApiBaseUrl,
} from './install-script';

const PRODUCTION = {
  apiBaseUrl: 'https://flowx.example.com/api',
  webOrigin: 'https://flowx.example.com',
  installUrl: 'https://flowx.example.com/install',
};

describe('buildInstallScript', () => {
  const script = buildInstallScript(PRODUCTION);

  it('uses a strict bash header', () => {
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('set -euo pipefail');
  });

  it('points missing Node at nodejs.org and the same install URL', () => {
    expect(script).toContain('https://nodejs.org/');
    expect(script).toContain(PRODUCTION.installUrl);
    expect(script).toMatch(/node -v/);
  });

  it('installs a pinned @flowx-ai/local that supports --api-base-url', () => {
    expect(script).toContain(
      'npm install -g @flowx-ai/local@0.4.9 --registry https://registry.npmjs.org',
    );
  });

  it('embeds the site API URL into setup --no-ide', () => {
    expect(script).toContain(
      `flowx-local setup --api-base-url '${PRODUCTION.apiBaseUrl}' --no-ide`,
    );
  });

  it('sets up Cursor and Codex when detected and the user answers Y', () => {
    expect(script).toContain('flowx-local setup cursor');
    expect(script).toContain('flowx-local setup codex');
    expect(script).toContain('/Applications/Cursor.app');
    expect(script).toContain('$HOME/Applications/Cursor.app');
    expect(script).toContain('command -v cursor');
    expect(script).toContain('/Applications/Codex.app');
    expect(script).toContain('$HOME/Applications/Codex.app');
    expect(script).toContain('command -v codex');
    expect(script).toContain('检测到 Cursor，要安装 FlowX Skill 和 MCP 吗？[Y/n]');
    expect(script).toContain('检测到 Codex，要安装 FlowX Skill 和 MCP 吗？[Y/n]');
    expect(script).toContain('未找到 Cursor');
    expect(script).toContain('未找到 Codex');
  });

  it('asks IDE questions via /dev/tty so curl | bash is still interactive', () => {
    expect(script).toContain('[ -r /dev/tty ]');
    expect(script).not.toContain('[ -t 0 ]');
    expect(script).toMatch(/read -r reply < \/dev\/tty/);
  });

  it('prints token settings URL and flowx-local login without prompting for a token', () => {
    expect(script).toContain(`${PRODUCTION.webOrigin}/settings/api-tokens`);
    expect(script).toContain('flowx-local login');
    expect(script).not.toContain('--token');
    expect(script).not.toContain('fxpat_');
  });

  it('exits on Windows via uname/OSTYPE', () => {
    expect(script).toMatch(/MINGW|MSYS|CYGWIN|Windows_NT/);
    expect(script).toMatch(/uname|OSTYPE/);
    expect(script.toLowerCase()).toMatch(/不支持|unsupported/);
  });

  it('does not embed loopback 3000 as a default', () => {
    expect(script).not.toContain('127.0.0.1:3000');
  });

  it('may embed loopback only when the caller passed that apiBaseUrl', () => {
    const loopback = buildInstallScript({
      apiBaseUrl: 'http://127.0.0.1:3000',
      webOrigin: 'http://127.0.0.1:4173',
      installUrl: 'http://127.0.0.1:4173/install',
    });
    expect(loopback).toContain("flowx-local setup --api-base-url 'http://127.0.0.1:3000' --no-ide");
  });
});

describe('resolveInstallApiBaseUrl', () => {
  it('prefers PUBLIC_API_BASE_URL and strips a trailing slash', () => {
    expect(
      resolveInstallApiBaseUrl({
        env: { PUBLIC_API_BASE_URL: 'https://flowx.example.com/api/' },
        requestOrigin: 'https://ignored.example',
      }),
    ).toBe('https://flowx.example.com/api');
  });

  it('falls back to FLOWX_PUBLIC_API_BASE_URL', () => {
    expect(
      resolveInstallApiBaseUrl({
        env: { FLOWX_PUBLIC_API_BASE_URL: 'https://alt.example/api/' },
        requestOrigin: 'https://ignored.example',
      }),
    ).toBe('https://alt.example/api');
  });

  it('uses requestOrigin plus /api when no public env is set', () => {
    expect(
      resolveInstallApiBaseUrl({
        env: { PORT: '3000' },
        requestOrigin: 'https://flowx.example.com',
      }),
    ).toBe('https://flowx.example.com/api');
  });

  it('never falls back to 127.0.0.1:3000 independently of requestOrigin', () => {
    expect(
      resolveInstallApiBaseUrl({
        env: { PORT: '3000' },
        requestOrigin: '',
      }),
    ).not.toContain('127.0.0.1:3000');
  });
});

describe('requestPublicOrigin', () => {
  it('uses the first x-forwarded-proto segment and x-forwarded-host', () => {
    expect(
      requestPublicOrigin({
        protocol: 'http',
        headers: {
          'x-forwarded-proto': 'https, http',
          'x-forwarded-host': 'flowx.example.com, localhost',
          host: 'internal:3000',
        },
      }),
    ).toBe('https://flowx.example.com');
  });

  it('falls back to Host and http when forwarded headers are missing', () => {
    expect(
      requestPublicOrigin({
        headers: {
          host: 'flowx.example.com',
        },
      }),
    ).toBe('http://flowx.example.com');
  });
});
