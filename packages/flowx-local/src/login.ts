import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { normalizeApiBaseUrl, resolveApiBaseUrl } from './api-base-url.js';
import { loadConfig, saveConfig } from './config.js';
import { writeCredentials } from './credentials.js';

export type LoginOptions = {
  homeDir?: string;
  promptApiBaseUrl?: () => Promise<string>;
  promptToken?: () => Promise<string>;
};

function readFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptToken(): Promise<string> {
  const token = await promptLine('Paste FlowX Personal API Token: ');
  if (!token) {
    throw new Error('Token is required.');
  }
  return token;
}

export async function promptApiBaseUrl(): Promise<string> {
  return promptLine('FlowX API 地址（例如 https://your-host/api）: ');
}

export async function validateApiToken(apiBaseUrl: string, apiToken: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/session/me`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Token validation failed (${response.status}): ${message || response.statusText}`,
    );
  }
}

export async function runLogin(argv: string[], options: LoginOptions = {}): Promise<void> {
  const configOptions = { homeDir: options.homeDir };
  const resolved = resolveApiBaseUrl({
    flag: readFlagValue(argv, '--api-base-url'),
    env: process.env.FLOWX_API_BASE_URL,
    config: loadConfig(configOptions).apiBaseUrl,
  });

  let apiBaseUrl: string;
  if (resolved.source === 'missing') {
    // 交互确认的地址视为已确认，即使是 loopback 占位值
    apiBaseUrl = normalizeApiBaseUrl(await (options.promptApiBaseUrl ?? promptApiBaseUrl)());
    if (!apiBaseUrl) {
      throw new Error(
        'apiBaseUrl is required. Pass --api-base-url, set FLOWX_API_BASE_URL, or enter an API URL when prompted.',
      );
    }
  } else {
    apiBaseUrl = resolved.url;
  }

  const tokenFromFlag = readFlagValue(argv, '--token');
  const apiToken = (tokenFromFlag ?? (await (options.promptToken ?? promptToken)())).trim();
  if (!apiToken) {
    throw new Error('Token is required. Pass --token or paste when prompted.');
  }

  await validateApiToken(apiBaseUrl, apiToken);

  const path = await writeCredentials({ apiBaseUrl, apiToken }, options.homeDir);
  saveConfig({ ...loadConfig(configOptions), apiBaseUrl }, configOptions);
  console.log(`Saved credentials to ${path}`);
  console.log(`apiBaseUrl=${apiBaseUrl}`);
}
