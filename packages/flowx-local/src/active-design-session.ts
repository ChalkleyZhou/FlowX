import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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

function asActiveDesignSession(
  parsed: Partial<ActiveDesignSessionRecord> & { workflowRunId?: string },
): ActiveDesignSessionRecord | null {
  if (
    !parsed.workflowRunId?.trim() ||
    !parsed.executionSessionId?.trim() ||
    !parsed.apiBaseUrl?.trim() ||
    !parsed.accessToken?.trim() ||
    !parsed.accessTokenExpiresAt?.trim()
  ) {
    return null;
  }
  return {
    workflowRunId: parsed.workflowRunId.trim(),
    executionSessionId: parsed.executionSessionId.trim(),
    apiBaseUrl: parsed.apiBaseUrl.trim().replace(/\/+$/, ''),
    accessToken: parsed.accessToken.trim(),
    accessTokenExpiresAt: parsed.accessTokenExpiresAt.trim(),
    ...(parsed.stage ? { stage: parsed.stage } : {}),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

async function readSessionFallback(homeDir: string): Promise<ActiveDesignSessionRecord | null> {
  const root = join(homeDir, '.flowx', 'design-sessions');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }

  const ranked: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const sessionPath = join(root, name, 'session.json');
    try {
      ranked.push({ path: sessionPath, mtimeMs: (await stat(sessionPath)).mtimeMs });
    } catch {
      // 忽略未完成的会话目录。
    }
  }
  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of ranked) {
    try {
      const parsed = JSON.parse(await readFile(item.path, 'utf8')) as Partial<ActiveDesignSessionRecord>;
      let workflowRunId = parsed.workflowRunId?.trim() ?? '';
      if (!workflowRunId) {
        const context = JSON.parse(
          await readFile(join(item.path, '..', 'context.json'), 'utf8'),
        ) as { workflowRunId?: string };
        workflowRunId = context.workflowRunId?.trim() ?? '';
      }
      const active = asActiveDesignSession({
        ...parsed,
        workflowRunId,
        updatedAt: new Date(item.mtimeMs).toISOString(),
      });
      if (active) return active;
    } catch {
      // 继续尝试下一个会话。
    }
  }
  return null;
}

export async function readActiveDesignSession(
  homeDir = homedir(),
): Promise<ActiveDesignSessionRecord | null> {
  try {
    const parsed = JSON.parse(
      await readFile(getActiveDesignSessionPath(homeDir), 'utf8'),
    ) as Partial<ActiveDesignSessionRecord>;
    const active = asActiveDesignSession(parsed);
    if (active) return active;
  } catch {
    // Fall back to the newest design session.
  }
  return readSessionFallback(homeDir);
}
