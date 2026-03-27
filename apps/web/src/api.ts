import type { AuthOrganization, AuthSession, Requirement, WorkflowRun, Workspace, Repository } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const AUTH_TOKEN_STORAGE_KEY = 'flowx-auth-token';

interface RequirementPayload {
  title: string;
  description: string;
  acceptanceCriteria: string;
  workspaceId: string;
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? '';
}

function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    let parsedMessage = '';
    try {
      const data = JSON.parse(text) as { message?: string | string[] };
      parsedMessage = Array.isArray(data.message) ? data.message.join('；') : data.message ?? '';
    } catch {
      // Ignore parse failures and fall back to raw text below.
    }
    throw new Error(parsedMessage || text || '请求失败');
  }

  return response.json() as Promise<T>;
}

export const authTokenStorageKey = AUTH_TOKEN_STORAGE_KEY;

export const api = {
  getAuthProviders: () => request<Array<{ name: string }>>('/auth/providers'),
  getDingTalkAuthorizeUrl: (redirectUri: string) =>
    request<{ provider: string; state: string; url: string }>(
      `/auth/dingtalk/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`,
    ),
  exchangeDingTalkCode: (payload: { code: string; state: string; redirectUri: string }) =>
    request<
      | {
          needOrganizationSelection: true;
          selectionToken: string;
          organizations: AuthOrganization[];
        }
      | ({
          needOrganizationSelection: false;
        } & AuthSession)
    >('/auth/dingtalk/exchange', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  selectOrganization: (payload: { selectionToken: string; organizationId: string }) =>
    request<
      {
        needOrganizationSelection: false;
      } & AuthSession
    >('/auth/organization/select', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  registerByPassword: (payload: {
    account: string;
    password: string;
    displayName?: string;
  }) =>
    request<AuthSession>('/auth/password/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  loginByPassword: (payload: {
    account: string;
    password: string;
  }) =>
    request<AuthSession>('/auth/password/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWorkspaces: () => request<Workspace[]>('/workspaces'),
  createWorkspace: (payload: { name: string; description?: string }) =>
    request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addRepositoryToWorkspace: (
    workspaceId: string,
    payload: { name: string; url: string; defaultBranch?: string },
  ) =>
    request<Repository>(`/workspaces/${workspaceId}/repositories`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRepositoryBranch: (
    workspaceId: string,
    repositoryId: string,
    payload: { currentBranch: string },
  ) =>
    request<Repository>(`/workspaces/${workspaceId}/repositories/${repositoryId}/branch`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getCurrentSession: () => request<AuthSession>('/auth/session/me'),
  getRequirements: () => request<Requirement[]>('/requirements'),
  createRequirement: (payload: RequirementPayload) =>
    request<Requirement>('/requirements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWorkflowRuns: () => request<WorkflowRun[]>('/workflow-runs'),
  getWorkflowRun: (id: string) => request<WorkflowRun>(`/workflow-runs/${id}`),
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
  setAuthToken,
  clearAuthToken,
};
