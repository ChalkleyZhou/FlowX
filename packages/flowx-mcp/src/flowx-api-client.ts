export interface FlowXApiClientOptions {
  baseUrl?: string;
  token?: string;
}

export interface StartHandoffInput {
  taskType: 'requirement' | 'bug';
  taskId: string;
  repositoryIds?: string[];
}

export interface CompleteLocalInput {
  pushed: boolean;
  implementationSummary?: string;
  testResult?: string;
  diffSummary?: string;
  untrackedFiles?: string[];
  repositories: Array<{
    workflowRepositoryId: string;
    headSha: string;
    changedFiles: string[];
    patchSummary?: string;
  }>;
}

export class FlowXApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: FlowXApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.FLOWX_API_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
    this.token = options.token ?? process.env.FLOWX_API_TOKEN ?? '';
  }

  listTasks(workspaceId?: string) {
    const params = new URLSearchParams();
    if (workspaceId?.trim()) {
      params.set('workspaceId', workspaceId.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/cursor-local/tasks${suffix}`);
  }

  getTaskContext(type: 'requirement' | 'bug', id: string) {
    return this.request(`/cursor-local/tasks/${encodeURIComponent(type)}/${encodeURIComponent(id)}/context`);
  }

  startHandoff(input: StartHandoffInput) {
    return this.request('/cursor-local/handoff', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  completeLocal(workflowRunId: string, body: CompleteLocalInput) {
    return this.request(`/workflow-runs/${encodeURIComponent(workflowRunId)}/execution/complete-local`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const message = await this.readErrorMessage(response);
      throw new Error(`FlowX API request failed (${response.status}): ${message}`);
    }

    return response.json();
  }

  private async readErrorMessage(response: Response) {
    const text = await response.text();
    if (!text) {
      return response.statusText || 'Request failed';
    }

    try {
      const data = JSON.parse(text) as { message?: string | string[] };
      if (Array.isArray(data.message)) {
        return data.message.join('; ');
      }
      return data.message ?? text;
    } catch {
      return text;
    }
  }
}
