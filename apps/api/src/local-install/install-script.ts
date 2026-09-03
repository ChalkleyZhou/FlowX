/**
 * 公开 GET /install 动态生成的 bash 向导。
 * 安装脚本禁止静默回落到 127.0.0.1:3000；仅当请求 origin 本身是 loopback 时才允许出现该地址。
 */

export type InstallScriptInput = {
  apiBaseUrl: string;
  webOrigin: string;
  installUrl: string;
};

export type InstallRequestLike = {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
};

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? '';
  }
  return value?.trim() ?? '';
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) {
      return firstHeader(value);
    }
  }
  return '';
}

function firstCommaPart(value: string): string {
  return value.split(',')[0]?.trim() ?? '';
}

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function requestPublicOrigin(req: InstallRequestLike): string {
  const protoHeader = headerValue(req.headers, 'x-forwarded-proto');
  const proto = firstCommaPart(protoHeader) || req.protocol?.trim() || 'http';
  const hostHeader =
    headerValue(req.headers, 'x-forwarded-host') || headerValue(req.headers, 'host');
  const host = firstCommaPart(hostHeader);
  return `${proto}://${host}`;
}

export function resolveInstallApiBaseUrl(input: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  requestOrigin: string;
}): string {
  const configured =
    input.env.PUBLIC_API_BASE_URL?.trim() ||
    input.env.FLOWX_PUBLIC_API_BASE_URL?.trim() ||
    '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const origin = input.requestOrigin.replace(/\/+$/, '');
  return `${origin}/api`;
}

export function buildInstallScript(input: InstallScriptInput): string {
  const apiBaseUrl = bashSingleQuote(input.apiBaseUrl);
  const webOrigin = input.webOrigin.replace(/\/+$/, '');
  const installUrl = input.installUrl;
  const tokenSettingsUrl = `${webOrigin}/settings/api-tokens`;

  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s 2>/dev/null || true)" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]] || [[ "\${OSTYPE:-}" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]]; then
  echo "FlowX 本地安装脚本暂不支持 Windows。请在 macOS 或 Linux 上运行。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 20 或更高版本。请从 https://nodejs.org/ 安装后，重新运行：" >&2
  echo "  curl -fsSL ${bashSingleQuote(installUrl)} | bash" >&2
  exit 1
fi

node_major="$(node -v | sed -E 's/^v([0-9]+).*/\\1/')"
if [ "\${node_major}" -lt 20 ]; then
  echo "需要 Node.js 20 或更高版本（当前: $(node -v)）。请从 https://nodejs.org/ 安装后，重新运行：" >&2
  echo "  curl -fsSL ${bashSingleQuote(installUrl)} | bash" >&2
  exit 1
fi

npm install -g @flowx-ai/local --registry https://registry.npmjs.org

flowx-local setup --api-base-url ${apiBaseUrl} --no-ide

cursor_found=0
if [ -d "/Applications/Cursor.app" ] || [ -d "\$HOME/Applications/Cursor.app" ] || command -v cursor >/dev/null 2>&1; then
  cursor_found=1
fi

codex_found=0
if [ -d "/Applications/Codex.app" ] || [ -d "\$HOME/Applications/Codex.app" ] || command -v codex >/dev/null 2>&1; then
  codex_found=1
fi

if [ -r /dev/tty ]; then
  if [ "\$cursor_found" -eq 1 ]; then
    printf '检测到 Cursor，要安装 FlowX Skill 和 MCP 吗？[Y/n] '
    read -r reply < /dev/tty || true
    case "\${reply:-Y}" in
      Y|y) flowx-local setup cursor ;;
    esac
  else
    echo "未找到 Cursor"
  fi
  if [ "\$codex_found" -eq 1 ]; then
    printf '检测到 Codex，要安装 FlowX Skill 和 MCP 吗？[Y/n] '
    read -r reply < /dev/tty || true
    case "\${reply:-Y}" in
      Y|y) flowx-local setup codex ;;
    esac
  else
    echo "未找到 Codex"
  fi
else
  echo "非交互环境，已跳过 IDE 集成。稍后可执行："
  echo "  flowx-local setup cursor"
  echo "  flowx-local setup codex"
fi

echo "请打开 ${tokenSettingsUrl} 生成 Personal API Token，然后执行："
echo "  flowx-local login"
`;
}
