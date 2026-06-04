import type { FlowXConfig } from './config';

export interface FlowXTaskItem {
  id: string;
  type: 'requirement' | 'bug';
  title: string;
  status: string;
  priority?: string | null;
  scheduleSignal?: string | null;
  repository: { id: string; name: string; url: string | null } | null;
  workflowRunId: string | null;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface StartLocalChatInput {
  taskType: 'requirement' | 'bug';
  taskId: string;
  repositoryIds?: string[];
}

export interface LocalChatHandoff {
  workflow: { id: string; status?: string };
  handoff: {
    workflowRunId: string;
    workflowRepositoryId?: string;
    repositories?: Array<{ id: string; name: string; url: string | null; workingBranch?: string }>;
  };
  chatPrompt: string;
  taskType: 'requirement' | 'bug';
  taskId: string;
}

export class FlowXClient {
  constructor(private readonly config: FlowXConfig) {}

  async listTasks(): Promise<FlowXTaskItem[]> {
    return this.request<FlowXTaskItem[]>(`/cursor-local/tasks?workspaceId=${encodeURIComponent(this.config.workspaceId)}`);
  }

  async startHandoff(input: StartLocalChatInput): Promise<LocalChatHandoff> {
    return this.request<LocalChatHandoff>('/cursor-local/handoff', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiToken}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `FlowX request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
