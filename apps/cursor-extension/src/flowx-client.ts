import type { FlowXConfig } from './config-model';

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
    repositories?: Array<{
      id?: string;
      workflowRepositoryId?: string;
      name: string;
      url: string | null;
      workingBranch?: string;
    }>;
  };
  chatPrompt: string;
  taskType: 'requirement' | 'bug';
  taskId: string;
}

export interface LocalHandoffPayload {
  workflowRunId: string;
  status?: string;
  executor?: 'LOCAL';
  requirement: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
  repositories: Array<{
    workflowRepositoryId: string;
    repositoryId?: string | null;
    name: string;
    url: string | null;
    baseBranch?: string;
    workingBranch: string;
  }>;
}

export interface CompleteLocalInput {
  repositories: Array<{
    workflowRepositoryId: string;
    headSha: string;
    changedFiles: string[];
    patchSummary?: string;
  }>;
  pushed: boolean;
  implementationSummary?: string;
  testResult?: string;
  diffSummary?: string;
  untrackedFiles?: string[];
}

export interface LocalDesignSubmission {
  design: Record<string, unknown>;
  demo: Record<string, unknown>;
  designArtifact: { html: string } & Record<string, unknown>;
}

export interface WorkflowStageExecution {
  stage: string;
  status: string;
  attempt?: number;
  statusMessage?: string | null;
  input?: unknown;
  output?: unknown;
}

export interface WorkflowRunDetail {
  id: string;
  status: string;
  runType?: string;
  requirement?: { id: string; title: string };
  stageExecutions: WorkflowStageExecution[];
  workflowRepositories?: Array<{
    id: string;
    name: string;
    url: string | null;
    workingBranch?: string;
  }>;
}

export class FlowXClient {
  constructor(private readonly config: FlowXConfig) {}

  async listTasks(): Promise<FlowXTaskItem[]> {
    return this.request<FlowXTaskItem[]>('/cursor-local/tasks');
  }

  async startHandoff(input: StartLocalChatInput): Promise<LocalChatHandoff> {
    return this.request<LocalChatHandoff>('/cursor-local/handoff', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getLocalHandoff(workflowRunId: string): Promise<LocalHandoffPayload> {
    return this.request<LocalHandoffPayload>(
      `/workflow-runs/${encodeURIComponent(workflowRunId)}/execution/local-handoff`,
    );
  }

  async completeLocal(workflowRunId: string, input: CompleteLocalInput): Promise<unknown> {
    return this.request(`/workflow-runs/${encodeURIComponent(workflowRunId)}/execution/complete-local`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getRun(workflowRunId: string): Promise<WorkflowRunDetail> {
    return this.request<WorkflowRunDetail>(`/workflow-runs/${encodeURIComponent(workflowRunId)}`);
  }

  /** POST a stage control endpoint, e.g. `design/confirm`, `plan/run`. */
  private post<T = unknown>(workflowRunId: string, action: string, body?: unknown): Promise<T> {
    return this.request<T>(`/workflow-runs/${encodeURIComponent(workflowRunId)}/${action}`, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  runDesign(id: string) {
    return this.post(id, 'design/run');
  }
  /** Submit a design generated locally (OpenDesign MCP) so it enters the confirmation gate. */
  submitLocalDesign(id: string, body: LocalDesignSubmission) {
    return this.post(id, 'design/submit-local', body);
  }
  confirmDesign(id: string) {
    return this.post(id, 'design/confirm');
  }
  rejectDesign(id: string) {
    return this.post(id, 'design/reject');
  }
  reviseDesign(id: string, feedback: string) {
    return this.post(id, 'design/revise', { feedback });
  }

  runDemo(id: string) {
    return this.post(id, 'demo/run');
  }
  confirmDemo(id: string) {
    return this.post(id, 'demo/confirm');
  }
  reviseDemo(id: string, feedback: string) {
    return this.post(id, 'demo/revise', { feedback });
  }

  runTaskSplit(id: string) {
    return this.post(id, 'task-split/run');
  }
  confirmTaskSplit(id: string) {
    return this.post(id, 'task-split/confirm');
  }
  rejectTaskSplit(id: string) {
    return this.post(id, 'task-split/reject');
  }
  reviseTaskSplit(id: string, feedback: string) {
    return this.post(id, 'task-split/revise', { feedback });
  }

  runPlan(id: string) {
    return this.post(id, 'plan/run');
  }
  confirmPlan(id: string) {
    return this.post(id, 'plan/confirm');
  }
  rejectPlan(id: string) {
    return this.post(id, 'plan/reject');
  }
  revisePlan(id: string, feedback: string) {
    return this.post(id, 'plan/revise', { feedback });
  }

  runExecution(id: string) {
    return this.post(id, 'execution/run');
  }

  runReview(id: string) {
    return this.post(id, 'review/run');
  }
  decideHumanReview(id: string, decision: string) {
    return this.post(id, 'human-review/decision', { decision });
  }

  claimLocal(id: string): Promise<LocalChatHandoff | unknown> {
    return this.post(id, 'execution/claim-local');
  }
  cancelLocal(id: string) {
    return this.post(id, 'execution/cancel-local');
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
