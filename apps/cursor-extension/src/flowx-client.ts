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

export class FlowXClient {
  constructor(private readonly config: FlowXConfig) {}

  async listTasks(): Promise<FlowXTaskItem[]> {
    return this.request<FlowXTaskItem[]>(`/cursor-local/tasks?workspaceId=${encodeURIComponent(this.config.workspaceId)}`);
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
