/**
 * 公开 GET /install 动态生成的 bash 向导。
 * 安装脚本禁止静默回落到 127.0.0.1:3000；仅当请求 origin 本身是 loopback 时才允许出现该地址。
 */

export type InstallScriptInput = {
  apiBaseUrl: string;
  webOrigin: string;
  installUrl: string;
  installPs1Url?: string;
};

/** 安装脚本钉死的 @flowx-ai/local 版本；发布新包后同步更新。 */
export const FLOWX_LOCAL_INSTALL_VERSION = '0.5.0';

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

function powershellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveInstallPs1Url(input: InstallScriptInput): string {
  if (input.installPs1Url?.trim()) {
    return input.installPs1Url.trim();
  }
  return `${input.webOrigin.replace(/\/+$/, '')}/install.ps1`;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) {
    return null;
  }
  const octets = match.slice(1, 5).map(Number) as [number, number, number, number];
  if (octets.some((part) => part > 255)) {
    return null;
  }
  return octets;
}

/** 内网 / loopback 地址不能写进用户本机的 apiBaseUrl。 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  const ipv4 = ipv4Octets(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
}

export function isPubliclyRoutableApiBaseUrl(raw: string): boolean {
  const parsed = parseUrl(raw);
  if (!parsed?.hostname) {
    return false;
  }
  return !isPrivateOrLocalHostname(parsed.hostname);
}

function fromRequestOrigin(requestOrigin: string): string {
  const origin = requestOrigin.replace(/\/+$/, '');
  if (!origin) {
    return '';
  }
  return `${origin}/api`;
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
  if (configured && isPubliclyRoutableApiBaseUrl(configured)) {
    return configured.replace(/\/+$/, '');
  }
  const fromRequest = fromRequestOrigin(input.requestOrigin);
  if (fromRequest) {
    return fromRequest;
  }
  return configured.replace(/\/+$/, '');
}

export function buildInstallScript(input: InstallScriptInput): string {
  const apiBaseUrl = bashSingleQuote(input.apiBaseUrl);
  const webOrigin = input.webOrigin.replace(/\/+$/, '');
  const installUrl = input.installUrl;
  const installPs1Url = resolveInstallPs1Url(input);
  const tokenSettingsUrl = `${webOrigin}/settings/api-tokens`;
  const pinnedPackage = `@flowx-ai/local@${FLOWX_LOCAL_INSTALL_VERSION}`;

  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s 2>/dev/null || true)" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]] || [[ "\${OSTYPE:-}" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]]; then
  echo "Windows 请在 PowerShell 中运行：" >&2
  echo "  irm ${installPs1Url} | iex" >&2
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

npm install -g ${pinnedPackage} --registry https://registry.npmjs.org

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

export function buildInstallPs1Script(input: InstallScriptInput): string {
  const apiBaseUrl = powershellSingleQuote(input.apiBaseUrl);
  const webOrigin = input.webOrigin.replace(/\/+$/, '');
  const installPs1Url = resolveInstallPs1Url(input);
  const tokenSettingsUrl = `${webOrigin}/settings/api-tokens`;
  const pinnedPackage = `@flowx-ai/local@${FLOWX_LOCAL_INSTALL_VERSION}`;

  return `$ErrorActionPreference = 'Stop'

function Test-FlowXCanPrompt {
  try {
    return [Environment]::UserInteractive -and ([Console]::WindowHandle -ne [IntPtr]::Zero)
  } catch {
    return $false
  }
}

function Invoke-FlowXLocal {
  param([Parameter(Mandatory = $true)][string[]]$FlowXArgs)
  $cmd = Get-Command flowx-local -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw '找不到 flowx-local。请把 npm 全局 bin 加入 PATH 后重试。'
  }
  & $cmd.Source @FlowXArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("flowx-local " + ($FlowXArgs -join ' ') + " failed")
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "需要 Node.js 20 或更高版本。请从 https://nodejs.org/ 安装后，重新运行："
  Write-Host "  irm ${installPs1Url} | iex"
  exit 1
}

$nodeVersion = node -v
if ($nodeVersion -notmatch '^v(\\d+)') {
  Write-Host "无法解析 Node 版本（当前: $nodeVersion）。请从 https://nodejs.org/ 安装 Node.js 20+ 后重试。"
  exit 1
}
$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 20) {
  Write-Host "需要 Node.js 20 或更高版本（当前: $nodeVersion）。请从 https://nodejs.org/ 安装后，重新运行："
  Write-Host "  irm ${installPs1Url} | iex"
  exit 1
}

npm install -g ${pinnedPackage} --registry https://registry.npmjs.org
$npmPrefix = (npm prefix -g).Trim()
if ($npmPrefix) {
  $env:Path = "$npmPrefix;$env:Path"
}

Invoke-FlowXLocal @('setup', '--api-base-url', ${apiBaseUrl}, '--no-ide')

$cursorFound = $false
$cursorCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\\cursor\\Cursor.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\\Cursor\\Cursor.exe')
)
foreach ($candidate in $cursorCandidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) {
    $cursorFound = $true
  }
}
if (Get-Command cursor -ErrorAction SilentlyContinue) {
  $cursorFound = $true
}

$codexFound = [bool](Get-Command codex -ErrorAction SilentlyContinue)

if (Test-FlowXCanPrompt) {
  if ($cursorFound) {
    $reply = Read-Host '检测到 Cursor，要安装 FlowX Skill 和 MCP 吗？[Y/n]'
    if ([string]::IsNullOrWhiteSpace($reply) -or $reply -match '^[Yy]') {
      Invoke-FlowXLocal @('setup', 'cursor')
    }
  } else {
    Write-Host '未找到 Cursor'
  }
  if ($codexFound) {
    $reply = Read-Host '检测到 Codex，要安装 FlowX Skill 和 MCP 吗？[Y/n]'
    if ([string]::IsNullOrWhiteSpace($reply) -or $reply -match '^[Yy]') {
      Invoke-FlowXLocal @('setup', 'codex')
    }
  } else {
    Write-Host '未找到 Codex'
  }
} else {
  Write-Host '非交互环境，已跳过 IDE 集成。稍后可执行：'
  Write-Host '  flowx-local setup cursor'
  Write-Host '  flowx-local setup codex'
}

Write-Host "请打开 ${tokenSettingsUrl} 生成 Personal API Token，然后执行："
Write-Host '  flowx-local login'
`;
}
