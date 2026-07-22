import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ActiveDesignSession = {
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

function asActiveSession(parsed: Partial<ActiveDesignSession> & {
  workflowRunId?: string;
}): ActiveDesignSession | null {
  if (
    !parsed.executionSessionId?.trim() ||
    !parsed.apiBaseUrl?.trim() ||
    !parsed.accessToken?.trim() ||
    !parsed.accessTokenExpiresAt?.trim()
  ) {
    return null;
  }
  const workflowRunId = parsed.workflowRunId?.trim() ?? '';
  if (!workflowRunId) {
    return null;
  }
  return {
    workflowRunId,
    executionSessionId: parsed.executionSessionId.trim(),
    apiBaseUrl: parsed.apiBaseUrl.trim().replace(/\/+$/, ''),
    accessToken: parsed.accessToken.trim(),
    accessTokenExpiresAt: parsed.accessTokenExpiresAt.trim(),
    stage: parsed.stage === 'brainstorm' ? 'brainstorm' : parsed.stage === 'design' ? 'design' : undefined,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

async function readSessionFallback(homeDir: string): Promise<ActiveDesignSession | null> {
  const root = join(homeDir, '.flowx', 'design-sessions');
  let entries: string[] = [];
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
      const info = await stat(sessionPath);
      ranked.push({ path: sessionPath, mtimeMs: info.mtimeMs });
    } catch {
      // skip
    }
  }
  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of ranked) {
    try {
      const session = JSON.parse(await readFile(item.path, 'utf8')) as Partial<ActiveDesignSession> & {
        workflowRunId?: string;
      };
      let workflowRunId = session.workflowRunId?.trim() ?? '';
      if (!workflowRunId) {
        try {
          const context = JSON.parse(
            await readFile(join(item.path, '..', 'context.json'), 'utf8'),
          ) as { workflowRunId?: string };
          workflowRunId = context.workflowRunId?.trim() ?? '';
        } catch {
          // ignore
        }
      }
      const active = asActiveSession({ ...session, workflowRunId, updatedAt: new Date(item.mtimeMs).toISOString() });
      if (active) return active;
    } catch {
      // try next
    }
  }
  return null;
}

export async function readActiveDesignSession(
  homeDir = homedir(),
): Promise<ActiveDesignSession | null> {
  try {
    const raw = await readFile(getActiveDesignSessionPath(homeDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ActiveDesignSession>;
    const active = asActiveSession(parsed);
    if (active) return active;
  } catch {
    // fall through to design-sessions
  }
  return readSessionFallback(homeDir);
}
