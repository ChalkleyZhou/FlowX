import { PACKAGE_VERSION } from './config.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const PACKAGE_NAME = '@flowx-ai/local';

export type VersionCheckResult = {
  installed: string;
  latest: string | null;
  updateAvailable: boolean;
  registry: string;
  message: string;
};

function parseSemver(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 若 remote 严格大于 local，返回 true。无法解析时返回 false。 */
export function isNewerVersion(remote: string, local: string): boolean {
  const a = parseSemver(remote);
  const b = parseSemver(local);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export async function fetchLatestNpmVersion(
  options: {
    registry?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const registry = (options.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${registry}/${PACKAGE_NAME}/latest`, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to query npm (${response.status}): ${response.statusText}`);
  }
  const body = (await response.json()) as { version?: string };
  const latest = body.version?.trim();
  if (!latest) {
    throw new Error('npm latest response did not include a version.');
  }
  return latest;
}

export async function checkPackageVersion(
  options: {
    installed?: string;
    registry?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<VersionCheckResult> {
  const installed = options.installed ?? PACKAGE_VERSION;
  const registry = (options.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const latest = await fetchLatestNpmVersion({
      registry,
      fetchImpl: options.fetchImpl,
      signal: controller.signal,
    });
    const updateAvailable = isNewerVersion(latest, installed);
    return {
      installed,
      latest,
      updateAvailable,
      registry,
      message: updateAvailable
        ? `Update available: ${installed} → ${latest}. Run: npm install -g ${PACKAGE_NAME}@${latest} --registry ${registry}`
        : `Up to date (${installed}).`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      installed,
      latest: null,
      updateAvailable: false,
      registry,
      message: `Installed ${installed}. Could not check npm for updates (${reason}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function formatVersionCheck(result: VersionCheckResult): string {
  const lines = [`@flowx-ai/local ${result.installed}`];
  if (result.latest) {
    lines.push(`latest (npm): ${result.latest}`);
  }
  lines.push(result.message);
  return lines.join('\n');
}
