/**
 * 用于用户可点击链接的 Web 公网根地址。
 * 未配置时返回 null，避免把 localhost 或内网地址发送给外部用户。
 */
export function resolvePublicWebBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.FLOWX_WEB_BASE_URL?.trim() || '';
  return configured ? configured.replace(/\/+$/, '') : null;
}
