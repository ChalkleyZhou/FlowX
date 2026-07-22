import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type ActiveDesignSessionRecord = {
  workflowRunId: string;
  executionSessionId: string;
  apiBaseUrl: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  stage?: 'brainstorm' | 'design';
  updatedAt: string;
};

export function getActiveDesignSessionPath(homeDir = homedir()) {
  return join(homeDir, '.flowx', 'active-design.json');
}

export async function writeActiveDesignSession(
  record: Omit<ActiveDesignSessionRecord, 'updatedAt'> & { updatedAt?: string },
  homeDir = homedir(),
) {
  const path = getActiveDesignSessionPath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  const body: ActiveDesignSessionRecord = {
    ...record,
    apiBaseUrl: record.apiBaseUrl.replace(/\/+$/, ''),
    updatedAt: record.updatedAt ?? new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  return path;
}
