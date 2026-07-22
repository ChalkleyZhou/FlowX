import { randomUUID } from 'node:crypto';
import type { ConfigOptions, LocalConfig } from './config.js';
import { loadConfig, saveConfig } from './config.js';

export function ensureDeviceIdentity(options: ConfigOptions = {}): LocalConfig {
  const config = loadConfig(options);
  if (config.installationId && config.deviceId) {
    return config;
  }
  const updated = {
    ...config,
    installationId: config.installationId || randomUUID(),
    deviceId: config.deviceId || randomUUID(),
  };
  saveConfig(updated, options);
  return updated;
}
