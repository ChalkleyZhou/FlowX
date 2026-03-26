import type { Requirement, WorkflowRun } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }

  return response.json() as Promise<T>;
}

export const api = {
  getRequirements: () => request<Requirement[]>('/requirements'),
  createRequirement: (payload: {
    title: string;
    description: string;
    acceptanceCriteria: string;
  }) =>
    request<Requirement>('/requirements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWorkflowRuns: () => request<WorkflowRun[]>('/workflow-runs'),
  createWorkflowRun: (requirementId: string) =>
    request<WorkflowRun>('/workflow-runs', {
      method: 'POST',
      body: JSON.stringify({ requirementId }),
    }),
  runTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/run`, { method: 'POST' }),
  confirmTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/confirm`, { method: 'POST' }),
  rejectTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/reject`, { method: 'POST' }),
  runPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/run`, { method: 'POST' }),
  confirmPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/confirm`, { method: 'POST' }),
  rejectPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/reject`, { method: 'POST' }),
  runExecution: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/execution/run`, { method: 'POST' }),
  runReview: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/run`, { method: 'POST' }),
  decideHumanReview: (id: string, decision: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/human-review/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
};
