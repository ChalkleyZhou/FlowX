import { homedir } from 'node:os';
import type { ConfigOptions } from './config.js';
import { ensureDeviceIdentity } from './device.js';
import { Outbox } from './outbox.js';
import { isServiceInstalled } from './user-service.js';

export type StatusFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean }>;

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
  service: {
    platform: NodeJS.Platform;
    installed: boolean;
    healthOk: boolean;
  };
};

async function probeHealth(
  port: number,
  fetchImpl: StatusFetch,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
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

  return {
    deviceId: config.deviceId,
    installationId: config.installationId,
    protocolVersion: config.protocolVersion,
    apiBaseUrl: config.apiBaseUrl,
    outboxPending: await new Outbox(options).pendingCount(),
    service: {
      platform,
      installed: isServiceInstalled(homeDir, platform),
      healthOk: await probeHealth(config.port, fetchImpl, timeoutMs),
    },
  };
}
