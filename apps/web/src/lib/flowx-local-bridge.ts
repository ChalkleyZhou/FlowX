export const FLOWX_LOCAL_DEFAULT_PORT = 3920;

const PROBE_TIMEOUT_MS = 800;

export function flowxLocalBaseUrl(port = FLOWX_LOCAL_DEFAULT_PORT) {
  return `http://127.0.0.1:${port}`;
}

export async function probeFlowxLocal(port?: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${flowxLocalBaseUrl(port)}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const data = (await response.json()) as { ok?: unknown };
    return data.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export type FlowxLocalLaunchBody = {
  ticket: string;
  ide: 'cursor' | 'codex';
  apiBaseUrl: string;
};

export type FlowxLocalLaunchResult = {
  ok: true;
  gitRoot: string;
  ide: string;
  prefilled: boolean;
  promptPath: string;
};

export async function launchFlowxLocal(
  body: FlowxLocalLaunchBody,
  port?: number,
): Promise<FlowxLocalLaunchResult> {
  const response = await fetch(`${flowxLocalBaseUrl(port)}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Launch failed');
  }

  if (
    data &&
    typeof data === 'object' &&
    'ok' in data &&
    (data as { ok: unknown }).ok === true
  ) {
    return data as FlowxLocalLaunchResult;
  }

  const errorMessage =
    data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : 'Launch failed';
  throw new Error(errorMessage);
}

export type OpenDesignLocalLaunchBody = {
  ticket: string;
  apiBaseUrl: string;
};

export type OpenDesignLocalLaunchResult = {
  ok: true;
  executionSessionId: string;
  workspacePath: string;
  contextPath: string;
  resultPath: string;
  opened: boolean;
};

export async function launchOpenDesignLocal(
  body: OpenDesignLocalLaunchBody,
  port?: number,
): Promise<OpenDesignLocalLaunchResult> {
  return postLocal('/design/launch', body, port) as Promise<OpenDesignLocalLaunchResult>;
}

export async function submitOpenDesignLocal(executionSessionId: string, port?: number) {
  return postLocal('/design/submit', { executionSessionId }, port) as Promise<{
    queued: boolean;
    error?: string;
  }>;
}

async function postLocal(path: string, body: unknown, port?: number) {
  const response = await fetch(`${flowxLocalBaseUrl(port)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'flowx-local request failed');
  }
  return data;
}
