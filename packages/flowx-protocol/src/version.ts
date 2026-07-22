export const FLOWX_PROTOCOL_VERSION = '1.0' as const;

export const SUPPORTED_FLOWX_PROTOCOL_VERSIONS = [FLOWX_PROTOCOL_VERSION] as const;

export type FlowXProtocolVersion = (typeof SUPPORTED_FLOWX_PROTOCOL_VERSIONS)[number];

export function isSupportedProtocolVersion(value: string): value is FlowXProtocolVersion {
  return SUPPORTED_FLOWX_PROTOCOL_VERSIONS.some((version) => version === value);
}
