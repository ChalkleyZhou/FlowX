import { homedir } from 'node:os';
import type { ConfigOptions } from './config.js';
import { ensureDeviceIdentity } from './device.js';
import { Outbox } from './outbox.js';
import { isServiceInstalled } from './user-service.js';
import { PACKAGE_VERSION } from './config.js';
import { autoUpdateEnabled } from './auto-update.js';
import { getUpdateContext, packageVersion, readUpdateState, selectPackageDir, type UpdateState } from './update-store.js';

export type StatusFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>;

export type BuildStatusPayloadOptions = ConfigOptions & {
  platform?: NodeJS.Platform;
  fetchImpl?: StatusFetch;
  healthTimeoutMs?: number;
};

export type StatusPayload = {
  deviceId: string;
  installationId: string;
  protocolVersion: string;
  apiBaseUrl: string;
  outboxPending: number;
  update: UpdateState & { runningVersion: string; readyVersion: string; enabled: boolean; development: boolean };
  service: {
    platform: NodeJS.Platform;
    installed: boolean;
    healthOk: boolean;
    version?: string;
  };
};

async function probeHealth(
  port: number,
  fetchImpl: StatusFetch,
  timeoutMs: number,
): Promise<{ healthOk: boolean; version?: string }> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { healthOk: false };
    let version: string | undefined;
    try {
      const body = await response.json?.();
      if (body && typeof body === 'object' && 'version' in body && typeof body.version === 'string') version = body.version;
    } catch { /* 兼容旧健康检查。 */ }
    return { healthOk: true, ...(version ? { version } : {}) };
  } catch {
    return { healthOk: false };
  }
}

export async function buildStatusPayload(
  options: BuildStatusPayloadOptions = {},
): Promise<StatusPayload> {
  const config = ensureDeviceIdentity(options);
  const homeDir = options.homeDir ?? homedir();
  const platform = options.platform ?? process.platform;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.healthTimeoutMs ?? 1500;
  const context = getUpdateContext({ homeDir });

  return {
    deviceId: config.deviceId,
    installationId: config.installationId,
    protocolVersion: config.protocolVersion,
    apiBaseUrl: config.apiBaseUrl,
    outboxPending: await new Outbox(options).pendingCount(),
    update: {
      ...readUpdateState(context),
      runningVersion: PACKAGE_VERSION,
      readyVersion: packageVersion(selectPackageDir(context)),
      enabled: autoUpdateEnabled(homeDir),
      development: context.development,
    },
    service: {
      platform,
      installed: isServiceInstalled(homeDir, platform),
      ...await probeHealth(config.port, fetchImpl, timeoutMs),
    },
  };
}
