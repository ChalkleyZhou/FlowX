import type { AuthOrganization, AuthSession, Bug, Issue, Project, Requirement, ReviewFinding, WorkflowRun, Workspace, Repository } from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/$/, '')
  : typeof window !== 'undefined'
    ? `${window.location.origin}/api`
    : 'http://localhost:3000';
const AUTH_TOKEN_STORAGE_KEY = 'flowx-auth-token';

function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
    return `${API_BASE_URL}${normalizedPath}`;
  }

  if (typeof window !== 'undefined') {
    return `${window.location.origin}${API_BASE_URL}${normalizedPath}`;
  }

  return `http://localhost:3000${normalizedPath}`;
}

interface RequirementPayload {
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  repositoryIds?: string[];
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
  const response = await fetch(buildApiUrl(path), {
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
export const apiBaseUrl = API_BASE_URL;
export const toApiUrl = buildApiUrl;

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
  getProjects: () => request<Project[]>('/projects'),
  createWorkspace: (payload: { name: string; description?: string }) =>
    request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createProject: (payload: { workspaceId: string; name: string; code?: string; description?: string }) =>
    request<Project>('/projects', {
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
  updateRepository: (
    workspaceId: string,
    repositoryId: string,
    payload: { name: string; defaultBranch?: string },
  ) =>
    request<Repository>(`/workspaces/${workspaceId}/repositories/${repositoryId}`, {
      method: 'PATCH',
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
  deleteRepository: (workspaceId: string, repositoryId: string) =>
    request<{ success: boolean }>(`/workspaces/${workspaceId}/repositories/${repositoryId}`, {
      method: 'DELETE',
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
  deleteWorkflowRun: (id: string) =>
    request<{ success: boolean }>(`/workflow-runs/${id}`, { method: 'DELETE' }),
  publishWorkflowGitChanges: (id: string) =>
    request<{
      message: string;
      repositories: Array<{
        repository: string;
        branch: string;
        commitSha: string;
        pushed: boolean;
        verified: boolean;
        remoteUrl: string;
      }>;
    }>(`/workflow-runs/${id}/git/publish`, { method: 'POST' }),
  createWorkflowRun: (requirementId: string, repositoryIds?: string[]) =>
    request<WorkflowRun>('/workflow-runs', {
      method: 'POST',
      body: JSON.stringify({ requirementId, repositoryIds }),
    }),
  runTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/run`, { method: 'POST' }),
  confirmTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/confirm`, { method: 'POST' }),
  rejectTaskSplit: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/reject`, { method: 'POST' }),
  reviseTaskSplit: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  manualEditTaskSplit: (id: string, output: unknown) =>
    request<WorkflowRun>(`/workflow-runs/${id}/task-split/manual-edit`, {
      method: 'PATCH',
      body: JSON.stringify({ output }),
    }),
  runPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/run`, { method: 'POST' }),
  confirmPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/confirm`, { method: 'POST' }),
  rejectPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/reject`, { method: 'POST' }),
  revisePlan: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  manualEditPlan: (id: string, output: unknown) =>
    request<WorkflowRun>(`/workflow-runs/${id}/plan/manual-edit`, {
      method: 'PATCH',
      body: JSON.stringify({ output }),
    }),
  runExecution: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/execution/run`, { method: 'POST' }),
  reviseExecution: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/execution/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  fixReviewFinding: (workflowRunId: string, findingId: string) =>
    request<WorkflowRun>(`/workflow-runs/${workflowRunId}/review-findings/${findingId}/fix`, {
      method: 'POST',
    }),
  manualEditExecution: (id: string, output: unknown) =>
    request<WorkflowRun>(`/workflow-runs/${id}/execution/manual-edit`, {
      method: 'PATCH',
      body: JSON.stringify({ output }),
    }),
  runReview: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/run`, { method: 'POST' }),
  getReviewFindings: (workflowRunId: string) =>
    request<ReviewFinding[]>(`/workflow-runs/${workflowRunId}/review-findings`),
  syncReviewFindings: (reviewReportId: string) =>
    request<ReviewFinding[]>(`/review-reports/${reviewReportId}/findings/sync`, { method: 'POST' }),
  acceptReviewFinding: (id: string) =>
    request<ReviewFinding>(`/review-findings/${id}/accept`, { method: 'POST' }),
  dismissReviewFinding: (id: string) =>
    request<ReviewFinding>(`/review-findings/${id}/dismiss`, { method: 'POST' }),
  convertReviewFindingToIssue: (id: string, payload?: { title?: string; description?: string; priority?: string }) =>
    request<Issue>(`/review-findings/${id}/convert-to-issue`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  convertReviewFindingToBug: (
    id: string,
    payload?: { title?: string; description?: string; severity?: string; priority?: string },
  ) =>
    request<Bug>(`/review-findings/${id}/convert-to-bug`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  getIssues: (params?: { workspaceId?: string; workflowRunId?: string; status?: string }) =>
    request<Issue[]>(
      `/issues?${new URLSearchParams(
        Object.entries(params ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
          if (value) {
            acc[key] = value;
          }
          return acc;
        }, {}),
      ).toString()}`,
    ),
  getIssue: (id: string) => request<Issue>(`/issues/${id}`),
  updateIssue: (
    id: string,
    payload: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      resolution?: string;
      branchName?: string;
    },
  ) =>
    request<Issue>(`/issues/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getBugs: (params?: { workspaceId?: string; workflowRunId?: string; status?: string }) =>
    request<Bug[]>(
      `/bugs?${new URLSearchParams(
        Object.entries(params ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
          if (value) {
            acc[key] = value;
          }
          return acc;
        }, {}),
      ).toString()}`,
    ),
  getBug: (id: string) => request<Bug>(`/bugs/${id}`),
  updateBug: (
    id: string,
    payload: {
      title?: string;
      description?: string;
      status?: string;
      severity?: string;
      priority?: string;
      expectedBehavior?: string;
      actualBehavior?: string;
      reproductionSteps?: string[];
      resolution?: string;
      branchName?: string;
    },
  ) =>
    request<Bug>(`/bugs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  reviseReview: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  manualEditReview: (id: string, output: unknown) =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/manual-edit`, {
      method: 'PATCH',
      body: JSON.stringify({ output }),
    }),
  decideHumanReview: (id: string, decision: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/human-review/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  setAuthToken,
  clearAuthToken,
};
