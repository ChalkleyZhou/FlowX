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
export const FLOWX_LOCAL_INSTALL_VERSION = '0.6.0';

/** 无系统 Node 时由安装器下载的固定 LTS runtime。 */
export const FLOWX_NODE_RUNTIME_VERSION = 'v22.14.0';

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
  const nodeRuntimeVersion = FLOWX_NODE_RUNTIME_VERSION;

  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s 2>/dev/null || true)" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]] || [[ "\${OSTYPE:-}" =~ (MINGW|MSYS|CYGWIN|Windows_NT) ]]; then
  echo "Windows 请在 PowerShell 中运行：" >&2
  echo "  irm ${installPs1Url} | iex" >&2
  exit 1
fi

flowx_home="\${FLOWX_HOME:-\$HOME/.flowx}"
flowx_runtime_root="\$flowx_home/runtime/${nodeRuntimeVersion}"
flowx_runtime_bin="\$flowx_runtime_root/bin"
flowx_node=""
flowx_npm=""

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node_major="$(node -v | sed -E 's/^v([0-9]+).*/\\1/')"
  if [ "\${node_major:-0}" -ge 20 ]; then
    flowx_node="$(command -v node)"
    flowx_npm="$(command -v npm)"
  fi
fi

if [ -z "\$flowx_node" ]; then
  case "$(uname -s)" in
    Darwin) flowx_platform="darwin" ;;
    Linux) flowx_platform="linux" ;;
    *) echo "暂不支持此 Unix 平台。请使用 Windows PowerShell 安装器，或手动安装 Node.js 20+。" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) flowx_arch="arm64" ;;
    x86_64|amd64) flowx_arch="x64" ;;
    *) echo "暂不支持此 CPU 架构：$(uname -m)" >&2; exit 1 ;;
  esac
  flowx_archive="node-${nodeRuntimeVersion}-\${flowx_platform}-\${flowx_arch}.tar.gz"
  flowx_url="https://nodejs.org/dist/${nodeRuntimeVersion}/\$flowx_archive"
  flowx_tmp="$(mktemp -d)"
  trap 'rm -rf "\$flowx_tmp"' EXIT
  echo "未检测到可用 Node.js，正在下载 FlowX 内置运行时 ${nodeRuntimeVersion}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "\$flowx_url" -o "\$flowx_tmp/\$flowx_archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "\$flowx_tmp/\$flowx_archive" "\$flowx_url"
  else
    echo "需要 curl 或 wget 才能下载 FlowX 内置运行时。" >&2
    exit 1
  fi
  case "\$flowx_archive" in
    node-v22.14.0-darwin-arm64.tar.gz) flowx_sha256="e9404633bc02a5162c5c573b1e2490f5fb44648345d64a958b17e325729a5e42" ;;
    node-v22.14.0-darwin-x64.tar.gz) flowx_sha256="6698587713ab565a94a360e091df9f6d91c8fadda6d00f0cf6526e9b40bed250" ;;
    node-v22.14.0-linux-arm64.tar.gz) flowx_sha256="8cf30ff7250f9463b53c18f89c6c606dfda70378215b2c905d0a9a8b08bd45e0" ;;
    node-v22.14.0-linux-x64.tar.gz) flowx_sha256="9d942932535988091034dc94cc5f42b6dc8784d6366df3a36c4c9ccb3996f0c2" ;;
    *) echo "没有此 runtime 的校验值：\$flowx_archive" >&2; exit 1 ;;
  esac
  if command -v shasum >/dev/null 2>&1; then
    flowx_actual_sha256="$(shasum -a 256 "\$flowx_tmp/\$flowx_archive" | awk '{print \$1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    flowx_actual_sha256="$(sha256sum "\$flowx_tmp/\$flowx_archive" | awk '{print \$1}')"
  else
    echo "需要 shasum 或 sha256sum 才能校验 FlowX 内置运行时。" >&2
    exit 1
  fi
  if [ "\$flowx_actual_sha256" != "\$flowx_sha256" ]; then
    echo "FlowX 内置运行时校验失败，已中止安装。" >&2
    exit 1
  fi
  mkdir -p "\$flowx_home/runtime"
  tar -xzf "\$flowx_tmp/\$flowx_archive" -C "\$flowx_tmp"
  rm -rf "\$flowx_runtime_root"
  mv "\$flowx_tmp/node-${nodeRuntimeVersion}-\${flowx_platform}-\${flowx_arch}" "\$flowx_runtime_root"
  flowx_node="\$flowx_runtime_bin/node"
  flowx_npm="\$flowx_runtime_bin/npm"
fi

flowx_prefix="\$flowx_home/npm"
export PATH="\$flowx_runtime_bin:\$PATH"
\"\$flowx_npm\" install -g --prefix "\$flowx_prefix" ${pinnedPackage} --registry https://registry.npmjs.org
flowx_entry="\$flowx_prefix/lib/node_modules/@flowx-ai/local/dist/index.js"
if [ ! -f "\$flowx_entry" ]; then
  echo "安装完成但找不到 flowx-local 入口：\$flowx_entry" >&2
  exit 1
fi

flowx_bin_dir="\$flowx_home/bin"
mkdir -p "\$flowx_bin_dir"
cat > "\$flowx_bin_dir/flowx-local" <<EOF
#!/usr/bin/env bash
export FLOWX_LOCAL_PREFIX="\$flowx_prefix"
export FLOWX_LOCAL_NPM="\$flowx_npm"
exec "\$flowx_node" "\$flowx_entry" "\\$@"
EOF
chmod 755 "\$flowx_bin_dir/flowx-local"
export PATH="\$flowx_bin_dir:\$flowx_runtime_bin:\$PATH"
flowx_path_line='export PATH="\$HOME/.flowx/bin:\$PATH"'
for flowx_profile in "\$HOME/.zshrc" "\$HOME/.bashrc"; do
  if [ -f "\$flowx_profile" ] && ! grep -Fq '# FlowX local agent' "\$flowx_profile"; then
    printf '\\n# FlowX local agent\\n%s\\n' "\$flowx_path_line" >> "\$flowx_profile"
  fi
done

"\$flowx_node" "\$flowx_entry" setup --api-base-url ${apiBaseUrl} --no-ide

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
      Y|y) "\$flowx_bin_dir/flowx-local" setup cursor ;;
    esac
  else
    echo "未找到 Cursor"
  fi
  if [ "\$codex_found" -eq 1 ]; then
    printf '检测到 Codex，要安装 FlowX Skill 和 MCP 吗？[Y/n] '
    read -r reply < /dev/tty || true
    case "\${reply:-Y}" in
      Y|y) "\$flowx_bin_dir/flowx-local" setup codex ;;
    esac
  else
    echo "未找到 Codex"
  fi
else
  echo "非交互环境，已跳过 IDE 集成。稍后可执行："
  echo "  \$flowx_bin_dir/flowx-local setup cursor"
  echo "  \$flowx_bin_dir/flowx-local setup codex"
fi

echo "请打开 ${tokenSettingsUrl} 生成 Personal API Token，然后执行："
echo "  \$flowx_bin_dir/flowx-local login"
echo "如需直接使用 flowx-local，请将 \$flowx_bin_dir 加入 PATH。"
`;
}

export function buildInstallPs1Script(input: InstallScriptInput): string {
  const apiBaseUrl = powershellSingleQuote(input.apiBaseUrl);
  const webOrigin = input.webOrigin.replace(/\/+$/, '');
  const installPs1Url = resolveInstallPs1Url(input);
  const tokenSettingsUrl = `${webOrigin}/settings/api-tokens`;
  const pinnedPackage = `@flowx-ai/local@${FLOWX_LOCAL_INSTALL_VERSION}`;
  const nodeRuntimeVersion = FLOWX_NODE_RUNTIME_VERSION;

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
  & $script:flowxLauncher @FlowXArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("flowx-local " + ($FlowXArgs -join ' ') + " failed")
  }
}

$flowxHome = Join-Path $HOME '.flowx'
$flowxRuntimeRoot = Join-Path $flowxHome 'runtime\\${nodeRuntimeVersion}'
$flowxRuntimeBin = $flowxRuntimeRoot
$flowxNode = $null
$flowxNpm = $null
$systemNode = Get-Command node -ErrorAction SilentlyContinue
$systemNpm = Get-Command npm -ErrorAction SilentlyContinue
if ($systemNode -and $systemNpm) {
  $nodeVersion = (& $systemNode.Source -v).Trim()
  if ($nodeVersion -match '^v(\\d+)' -and [int]$Matches[1] -ge 20) {
    $flowxNode = $systemNode.Source
    $flowxNpm = $systemNpm.Source
  }
}

if (-not $flowxNode) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  $archive = "node-${nodeRuntimeVersion}-win-$arch.zip"
  $runtimeUrl = "https://nodejs.org/dist/${nodeRuntimeVersion}/$archive"
  $runtimeTemp = Join-Path ([IO.Path]::GetTempPath()) ("flowx-node-" + [guid]::NewGuid().ToString('N'))
  $archivePath = Join-Path $runtimeTemp $archive
  New-Item -ItemType Directory -Force -Path $runtimeTemp | Out-Null
  Write-Host "未检测到可用 Node.js，正在下载 FlowX 内置运行时 ${nodeRuntimeVersion}..."
  Invoke-WebRequest -Uri $runtimeUrl -OutFile $archivePath
  $expectedHash = switch ($archive) {
    'node-v22.14.0-win-arm64.zip' { '2d71f5f9b2fffa33baa108c07d74b0d24e0c3dd8f441d567772ae0e3dd4b1a22' }
    'node-v22.14.0-win-x64.zip' { '55b639295920b219bb2acbcfa00f90393a2789095b7323f79475c9f34795f217' }
    default { throw "没有此 runtime 的校验值：$archive" }
  }
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw 'FlowX 内置运行时校验失败，已中止安装。' }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeTemp -Force
  $extracted = Join-Path $runtimeTemp ("node-${nodeRuntimeVersion}-win-$arch")
  if (Test-Path -LiteralPath $flowxRuntimeRoot) { Remove-Item -LiteralPath $flowxRuntimeRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Split-Path $flowxRuntimeRoot) | Out-Null
  Move-Item -LiteralPath $extracted -Destination $flowxRuntimeRoot
  $flowxNode = Join-Path $flowxRuntimeBin 'node.exe'
  $flowxNpm = Join-Path $flowxRuntimeBin 'npm.cmd'
}

$flowxPrefix = Join-Path $flowxHome 'npm'
& $flowxNpm install -g --prefix $flowxPrefix ${pinnedPackage} --registry https://registry.npmjs.org
$flowxEntry = Join-Path $flowxPrefix 'node_modules\\@flowx-ai\\local\\dist\\index.js'
if (-not (Test-Path -LiteralPath $flowxEntry)) { throw "安装完成但找不到 flowx-local 入口：$flowxEntry" }
$flowxBinDir = Join-Path $flowxHome 'bin'
New-Item -ItemType Directory -Force -Path $flowxBinDir | Out-Null
$script:flowxLauncher = Join-Path $flowxBinDir 'flowx-local.cmd'
$launcherContent = @"
@echo off
set "FLOWX_LOCAL_PREFIX=$flowxPrefix"
set "FLOWX_LOCAL_NPM=$flowxNpm"
"$flowxNode" "$flowxEntry" %*
"@
Set-Content -LiteralPath $script:flowxLauncher -Encoding ASCII -Value $launcherContent
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $flowxBinDir)) {
  [Environment]::SetEnvironmentVariable('Path', ((@($userPath) + $flowxBinDir) -join ';'), 'User')
}
$env:Path = "$flowxBinDir;$env:Path"

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
  Write-Host "  $script:flowxLauncher setup cursor"
  Write-Host "  $script:flowxLauncher setup codex"
}

Write-Host "请打开 ${tokenSettingsUrl} 生成 Personal API Token，然后执行："
Write-Host "  $script:flowxLauncher login"
Write-Host "如需直接使用 flowx-local，请将 $flowxBinDir 加入用户 PATH。"
`;
}
