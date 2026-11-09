import type { PageQuery, PageResult } from './types';
import type { WorkflowCollaboration } from './utils/workflow-collaboration';
import type {
  AuthOrganization,
  AuthSession,
  AiCredentialStatus,
  OnlineAiPolicy,
  OnlineAiProviders,
  GitCredentialStatus,
  Briefing,
  BriefingPeriod,
  BriefingSource,
  Bug,
  DailyCodeReview,
  DeliveryTarget,
  DingTalkUserSyncResult,
  ExecutionSessionDetail,
  ExecutionSessionsPage,
  ExecutionSessionView,
  ExecutionCommand,
  ExecutionCommandType,
  ExecutionSessionStatus,
  SourceTool,
  ExecutionSessionEvidence,
  ExecutionSessionSyncEvent,
  Issue,
  IdeationSessionEvent,
  GanttPayload,
  CompleteLocalRepositoryReport,
  LocalDevDetectResponse,
  LocalDevPreviewStatus,
  LocalExecutionClaimResponse,
  LocalHandoffPayload,
  LocalSpecPlanClaimResponse,
  OpenDesignHandoff,
  OpenDesignHandoffResponse,
  OrganizationMember,
  PersonalApiTokenCreated,
  PersonalApiTokenMeta,
  PrototypeImport,
  PrototypeImportUpdate,
  Project,
  ProjectFeed,
  ProjectVersionSummary,
  RequirementAssignment,
  RequirementChange,
  RequirementChangePayload,
  RequirementChanges,
  Repository,
  Requirement,
  ReviewFinding,
  SpecPlanOutput,
  TestCaseDefinition,
  TestCaseImportRow,
  TestCaseLibrary,
  TestCaseModule,
  TestCasePage,
  QualityCaseSelection,
  CreateManualTestRunInput,
  CreateLocalTestRunInput,
  QualityTestReport,
  QualityReportInput,
  QualityRequestReportInput,
  QualitySupersession,
  TestDesign,
  TestDesignCandidate,
  TestRequest,
  TestRequestAssignmentsPage,
  TestRequestScopeDraft,
  TestRun,
  ArtifactSummary,
  TestedRepositoryRevision,
  WorkflowDesignArtifactPage,
  WorkflowDesignArtifactsList,
  WorkflowRun,
  WorkflowCodeDelivery,
  Workspace,
  YunxiaoIntegrationStatus,
  YunxiaoProjectMembersResponse,
  YunxiaoUnmatchedRecipient,
} from './types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/$/, '')
  : typeof window !== 'undefined'
    ? `${window.location.origin}/api`
    : 'http://localhost:3000';
const AUTH_TOKEN_STORAGE_KEY = 'flowx-auth-token';
const pendingGetRequests = new Map<string, Promise<unknown>>();

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
  priority?: string;
  description?: string;
  acceptanceCriteria?: string;
  functionalModule?: string;
  riskImpact?: string;
  productRequirementDocument?: string;
  remark?: string;
  repositoryIds?: string[];
  versionId?: string;
}

function queryString(params?: Record<string, unknown>) {
  const search = new URLSearchParams(
    Object.entries(params ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
      if (key === 'parentId' && value === null) { acc[key] = 'null'; }
      else if (value !== undefined && value !== null && value !== '') {
        acc[key] = Array.isArray(value) ? value.join(',') : String(value);
      }
      return acc;
    }, {}),
  ).toString();
  const text = search.toString();
  return text ? `?${text}` : '';
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

function normalizeHeaders(headers?: HeadersInit) {
  if (!headers) {
    return '';
  }

  const normalizedHeaders = new Headers(headers);
  const headerEntries: Array<[string, string]> = [];

  normalizedHeaders.forEach((value, key) => {
    headerEntries.push([key, value]);
  });

  return JSON.stringify(headerEntries.sort(([left], [right]) => left.localeCompare(right)));
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit, responseType: 'json' | 'blob' = 'json'): Promise<T> {
  const token = getAuthToken();
  const url = buildApiUrl(path);
  const requestOptions = {
    headers: {
      ...(!(typeof FormData !== 'undefined' && options?.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      'X-FlowX-List-Contract': 'pagination-v1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
    ...options,
  };
  const method = (requestOptions.method ?? 'GET').toUpperCase();
  const requestKey =
    method === 'GET'
      ? JSON.stringify([url, token, normalizeHeaders(requestOptions.headers)])
      : null;

  if (requestKey) {
    const pendingRequest = pendingGetRequests.get(requestKey);
    if (pendingRequest) {
      return pendingRequest as Promise<T>;
    }
  }

  const requestPromise = (async () => {
    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const text = await response.text();
      let parsedMessage = '';
      try {
        const data = JSON.parse(text) as { message?: string | string[] };
        parsedMessage = Array.isArray(data.message) ? data.message.join('；') : data.message ?? '';
      } catch {
        // Ignore parse failures and fall back to raw text below.
      }
      throw new ApiError(parsedMessage || text || '请求失败', response.status);
    }

    return (responseType === 'blob' ? response.blob() : response.json()) as Promise<T>;
  })();

  if (requestKey) {
    pendingGetRequests.set(requestKey, requestPromise);
    requestPromise.then(
      () => {
        pendingGetRequests.delete(requestKey);
      },
      () => {
        pendingGetRequests.delete(requestKey);
      },
    );
  }

  return requestPromise;
}

export const authTokenStorageKey = AUTH_TOKEN_STORAGE_KEY;
export const apiBaseUrl = API_BASE_URL;
export const toApiUrl = buildApiUrl;

/**
 * Absolute FlowX API base for local daemons (e.g. flowx-local redeem / MCP).
 * Prefer an absolute VITE_API_BASE_URL; resolve relative paths (e.g. `/api`)
 * against the current page origin so deployed Web never sends 127.0.0.1 to the
 * developer machine. Do not use the Vite `${origin}/api` proxy assumption alone
 * without an origin — the daemon must reach Nest (or the reverse proxy) directly.
 */
export function getFlowxApiBaseUrl(
  envBaseUrl: string | undefined = configuredApiBaseUrl,
  origin: string | undefined = typeof window !== 'undefined' ? window.location.origin : undefined,
): string {
  const configured = envBaseUrl?.trim().replace(/\/$/, '') ?? '';
  if (configured) {
    if (configured.startsWith('http://') || configured.startsWith('https://')) {
      return configured;
    }
    if (origin) {
      const path = configured.startsWith('/') ? configured : `/${configured}`;
      return `${origin.replace(/\/$/, '')}${path}`;
    }
  }
  if (origin) {
    return `${origin.replace(/\/$/, '')}/api`;
  }
  return 'http://127.0.0.1:3000';
}

export function getBugScreenshotUrl(bugId: string, screenshotId: string) {
  return buildApiUrl(`/bugs/${bugId}/screenshots/${screenshotId}`);
}


export type ListQuery = PageQuery & {
  workspaceId?: string; projectId?: string; versionId?: string; projectVersionId?: string;
  requirementId?: string; workflowRunId?: string; status?: string; priority?: string;
  planningStatus?: string; severity?: string; runType?: string; role?: string;
  libraryId?: string; moduleId?: string; parentId?: string | null;
  libraryIds?: string[]; moduleIds?: string[]; priorities?: string[]; selectedRunIds?: string[]; ownership?: 'project' | 'shared';
  purpose?: 'briefing' | 'codeReview'; kind?: string; activeOnly?: boolean; terminalOnly?: boolean; excludeSuperseded?: boolean; availableForRequest?: boolean; workflowRunIds?: string[]; excludeId?: string;
  bugId?: string; executionSessionId?: string; result?: string; targetId?: string; testRequestId?: string; testRunId?: string;
};

async function requestPage<T>(path: string, query: ListQuery = {}): Promise<PageResult<T>> {
  const result = await request<PageResult<T>>(`${path}${queryString({ page: 1, pageSize: 20, ...query })}`);
  if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total)
      || !Number.isSafeInteger(result.page) || !Number.isSafeInteger(result.pageSize)
      || !Number.isSafeInteger(result.totalPages)) {
    throw new ApiError('分页接口契约不受支持，请升级 FlowX 服务端并刷新页面。', 426);
  }
  return result;
}

export const api = {
  createPrototypeImport: (payload: { projectId: string; title?: string; versionId?: string; goal?: string; aiProvider?: 'codex' | 'cursor' }, file: File) => {
    const body = new FormData(); body.append('file', file); body.append('projectId', payload.projectId);
    if (payload.title) body.append('title', payload.title);
    if (payload.versionId !== undefined) body.append('versionId', payload.versionId);
    if (payload.goal) body.append('goal', payload.goal);
    if (payload.aiProvider) body.append('aiProvider', payload.aiProvider);
    return request<PrototypeImport>('/prototype-imports', { method: 'POST', body });
  },
  getPrototypeImport: (id: string) => request<PrototypeImport>(`/prototype-imports/${id}`),
  savePrototypeImport: (id: string, payload: PrototypeImportUpdate) => request<PrototypeImport>(`/prototype-imports/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  analyzePrototypeImport: (id: string, payload: PrototypeImportUpdate & { aiProvider?: PrototypeImport['aiProvider'] }) => request<PrototypeImport>(`/prototype-imports/${id}/analyze`, { method: 'POST', body: JSON.stringify(payload) }),
  confirmPrototypeImport: (id: string, payload: PrototypeImportUpdate) => request<PrototypeImport>(`/prototype-imports/${id}/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  supplementPrototypeImport: (id: string, revision: number, file: File, aiProvider?: PrototypeImport['aiProvider'], replace = false) => {
    const body = new FormData(); body.append('file', file); body.append('revision', String(revision));
    if (aiProvider !== undefined) body.append('aiProvider', aiProvider);
    if (replace) body.append('replace', 'true');
    return request<PrototypeImport>(`/prototype-imports/${id}/files`, { method: 'POST', body });
  },
  previewPrototypeImport: (id: string, path: string) => request<{ html: string; warnings: string[] }>(`/prototype-imports/${id}/preview?path=${encodeURIComponent(path)}`),
  downloadPrototypeImport: (id: string, revision: number) => request<Blob>(`/prototype-imports/${id}/source?revision=${revision}`, undefined, 'blob'),
  getWorkflowProviders: () => request<OnlineAiProviders>('/workflow-runs/providers'),
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
  getWorkspaces: (query?: ListQuery) => requestPage<Workspace>('/workspaces', query),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  getWorkspaceRepositories: (id: string, query?: ListQuery) => requestPage<Repository>(`/workspaces/${id}/repositories`, query),
  getRepository: (workspaceId: string, repositoryId: string) => request<Repository>(`/workspaces/${workspaceId}/repositories/${repositoryId}`),
  getProjects: (query?: ListQuery) => requestPage<Project>('/projects', query),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  listProjectVersions: (projectId: string, query?: ListQuery) => requestPage<ProjectVersionSummary>(`/projects/${projectId}/versions`, query),
  getProjectVersion: (projectId: string, versionId: string) => request<ProjectVersionSummary>(`/projects/${projectId}/versions/${versionId}`),
  createProjectVersion: (projectId: string, payload: { name: string }) =>
    request<ProjectVersionSummary>(`/projects/${projectId}/versions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProjectVersion: (projectId: string, versionId: string, payload: { name: string }) =>
    request<ProjectVersionSummary>(`/projects/${projectId}/versions/${versionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteProjectVersion: (projectId: string, versionId: string) =>
    request<{ ok: true }>(`/projects/${projectId}/versions/${versionId}`, { method: 'DELETE' }),
  updateProjectCurrentVersion: (projectId: string, currentVersionId: string | null) =>
    request<Project>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ currentVersionId }),
    }),
  getOrganizationMembers: (query?: ListQuery) => requestPage<OrganizationMember>('/auth/organization/members', query),
  syncDingTalkOrganizationUsers: () =>
    request<DingTalkUserSyncResult>('/auth/organization/members/sync-dingtalk', {
      method: 'POST',
    }),
  resolveOrganizationMemberEmail: (userId: string) =>
    request<{ email: string; source: 'profile' | 'dingtalk' }>(
      `/auth/organization/members/${userId}/email`,
    ),
  createOrganizationMember: (payload: {
    account: string;
    password?: string;
    displayName?: string;
    role?: 'member' | 'sub_admin';
  }) =>
    request<OrganizationMember>('/auth/organization/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOrganizationMember: (
    userId: string,
    payload: {
      displayName?: string;
      status?: 'ACTIVE' | 'DISABLED';
      role?: 'member' | 'sub_admin';
    },
  ) =>
    request<OrganizationMember>(`/auth/organization/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  transferOrganizationAdmin: (payload: { targetUserId: string }) =>
    request<OrganizationMember>('/auth/organization/admin/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  removeOrganizationMember: (userId: string) =>
    request<{ removed: boolean }>(`/auth/organization/members/${userId}`, {
      method: 'DELETE',
    }),
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
  getBriefingSources: (query?: ListQuery) => requestPage<BriefingSource>('/briefing-sources', query),
  resolveBriefingRepositoryBinding: (params: {
    workspaceId: string;
    repositoryId: string;
  }) =>
    request<{
      repositoryId: string;
      repositoryName: string;
      repositoryUrl: string;
      provider: 'github' | 'gitlab';
      externalPath: string;
      host: string;
    }>(`/briefing-sources/repository-binding${queryString(params)}`),
  createBriefingSource: (payload: {
    workspaceId: string;
    repositoryId: string;
    webhookSecret?: string;
    provider?: 'github' | 'gitlab';
    externalPath?: string;
    isActive?: boolean;
  }) =>
    request<BriefingSource>('/briefing-sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBriefingSource: (
    id: string,
    payload: {
      webhookSecret?: string;
      isActive?: boolean;
    },
  ) =>
    request<BriefingSource>(`/briefing-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  regenerateBriefingSourceWebhookSecret: (id: string) =>
    request<BriefingSource>(`/briefing-sources/${id}/regenerate-webhook-secret`, {
      method: 'POST',
    }),
  deleteBriefingSource: (id: string) =>
    request<{ success: true }>(`/briefing-sources/${id}`, { method: 'DELETE' }),
  listBriefingFeeds: (projectId: string, query?: ListQuery) => requestPage<ProjectFeed>(`/projects/${projectId}/briefing-feeds`, query),
  createBriefingFeed: (
    projectId: string,
    payload: {
      name: string;
      enabled?: boolean;
      dailyHour?: number;
      autoSend?: boolean;
      repositoryIds?: string[];
      deliveryTargetIds?: string[];
    },
  ) =>
    request<ProjectFeed>(`/projects/${projectId}/briefing-feeds`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBriefingFeed: (
    id: string,
    payload: {
      name?: string;
      enabled?: boolean;
      dailyHour?: number;
      autoSend?: boolean;
      repositoryIds?: string[];
      deliveryTargetIds?: string[];
    },
  ) =>
    request<ProjectFeed>(`/briefing-feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteBriefingFeed: (id: string) =>
    request<{ success: true }>(`/briefing-feeds/${id}`, { method: 'DELETE' }),
  getProjectBriefings: (projectId: string, query?: ListQuery) => requestPage<Briefing>(`/projects/${projectId}/briefings`, query),
  generateBriefingFeed: (
    feedId: string,
    payload: {
      period?: BriefingPeriod;
      date?: string;
      regenerate?: boolean;
    },
  ) =>
    request<Briefing>(`/briefing-feeds/${feedId}/generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getBriefingDeliveryLogs: (id:string,query?:ListQuery) => requestPage<NonNullable<Briefing['deliveryLogs']>[number]>(`/briefings/${id}/delivery-logs`,query),
  getCodeReviewDeliveryLogs: (id:string,query?:ListQuery) => requestPage<NonNullable<DailyCodeReview['deliveryLogs']>[number]>(`/daily-code-reviews/${id}/delivery-logs`,query),
  getBriefing: (id: string) => request<Briefing>(`/briefings/${id}`),
  sendBriefing: (id: string) =>
    request<{ successCount: number; targetCount: number }>(`/briefings/${id}/send`, {
      method: 'POST',
    }),
  listProjectDailyCodeReviews: (projectId: string, query?: ListQuery) => requestPage<DailyCodeReview>(`/projects/${projectId}/daily-code-reviews`, query),
  listCodeReviewFeeds: (projectId: string, query?: ListQuery) => requestPage<ProjectFeed>(`/projects/${projectId}/code-review-feeds`, query),
  createCodeReviewFeed: (
    projectId: string,
    payload: {
      name: string;
      enabled?: boolean;
      dailyHour?: number;
      autoSend?: boolean;
      repositoryIds?: string[];
      deliveryTargetIds?: string[];
    },
  ) =>
    request<ProjectFeed>(`/projects/${projectId}/code-review-feeds`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCodeReviewFeed: (
    id: string,
    payload: {
      name?: string;
      enabled?: boolean;
      dailyHour?: number;
      autoSend?: boolean;
      repositoryIds?: string[];
      deliveryTargetIds?: string[];
    },
  ) =>
    request<ProjectFeed>(`/code-review-feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCodeReviewFeed: (id: string) =>
    request<{ success: true }>(`/code-review-feeds/${id}`, { method: 'DELETE' }),
  generateCodeReviewFeed: (
    feedId: string,
    payload: {
      date?: string;
      regenerate?: boolean;
    },
  ) =>
    request<DailyCodeReview>(`/code-review-feeds/${feedId}/generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getDailyCodeReview: (id: string) => request<DailyCodeReview>(`/daily-code-reviews/${id}`),
  sendDailyCodeReview: (id: string) =>
    request<{ successCount: number; targetCount: number }>(`/daily-code-reviews/${id}/send`, {
      method: 'POST',
    }),
  getDeliveryTargets: (query?: ListQuery) => requestPage<DeliveryTarget>('/delivery-targets', query),
  createDeliveryTarget: (payload: {
    projectId: string;
    type: string;
    name: string;
    userId?: string;
    emailAddress?: string;
    dingtalkWebhookUrl?: string;
    dingtalkSecret?: string;
    isActive?: boolean;
    forBriefing?: boolean;
    forCodeReview?: boolean;
  }) =>
    request<DeliveryTarget>('/delivery-targets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDeliveryTarget: (
    id: string,
    payload: {
      type?: string;
      name?: string;
      emailAddress?: string;
      dingtalkWebhookUrl?: string;
      dingtalkSecret?: string;
      isActive?: boolean;
      forBriefing?: boolean;
      forCodeReview?: boolean;
    },
  ) =>
    request<DeliveryTarget>(`/delivery-targets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteDeliveryTarget: (id: string) =>
    request<DeliveryTarget>(`/delivery-targets/${id}`, { method: 'DELETE' }),
  addRepositoryToWorkspace: (
    workspaceId: string,
    payload: { name: string; url: string; defaultBranch?: string },
  ) =>
    request<Repository>(`/workspaces/${workspaceId}/repositories`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resyncWorkspaceRepository: (workspaceId: string, repositoryId: string) =>
    request<Repository>(`/workspaces/${workspaceId}/repositories/${repositoryId}/sync`, {
      method: 'POST',
    }),
  updateRepository: (
    workspaceId: string,
    repositoryId: string,
    payload: { name: string; url: string; defaultBranch?: string },
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
  getYunxiaoIntegration: () =>
    request<YunxiaoIntegrationStatus>('/integrations/yunxiao'),
  getYunxiaoUnmatchedRecipients: (query?:ListQuery) =>
    requestPage<YunxiaoUnmatchedRecipient>('/integrations/yunxiao/unmatched-recipients',query),
  clearYunxiaoUnmatchedRecipients: () =>
    request<{ deletedCount: number }>('/integrations/yunxiao/unmatched-recipients', {
      method: 'DELETE',
    }),
  getYunxiaoProjectMembers: (projectId: string, userId: string) =>
    request<YunxiaoProjectMembersResponse>(
      `/integrations/yunxiao/members?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}`,
    ),
  updateYunxiaoMemberMapping: (payload: {
    yunxiaoMemberId: string | null;
    yunxiaoUserId: string | null;
    aliyunAccountId: string | null;
    yunxiaoUserIdentifier?: string;
    yunxiaoDisplayName?: string;
    flowxUserId: string | null;
  }) =>
    request('/integrations/yunxiao/member-mapping', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  updateYunxiaoIntegration: (payload: {
    enabled: boolean;
    yunxiaoOrganizationIdentifier?: string | null;
  }) =>
    request<YunxiaoIntegrationStatus>('/integrations/yunxiao', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getOnlineAiPolicy: () => request<OnlineAiPolicy>('/auth/ai-credentials/policy'),
  setPreferredAiProvider: (provider: 'codex' | 'cursor') =>
    request<OnlineAiPolicy>('/auth/ai-credentials/preference', {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    }),
  getCursorCredentialStatus: () =>
    request<AiCredentialStatus>('/auth/ai-credentials/cursor'),
  upsertCursorCredential: (payload: { apiKey: string }) =>
    request<AiCredentialStatus>('/auth/ai-credentials/cursor', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCursorCredential: () =>
    request<AiCredentialStatus>('/auth/ai-credentials/cursor', {
      method: 'DELETE',
    }),
  getCodexCredentialStatus: () =>
    request<AiCredentialStatus>('/auth/ai-credentials/codex'),
  upsertCodexCredential: (payload: { apiKey: string }) =>
    request<AiCredentialStatus>('/auth/ai-credentials/codex', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCodexCredential: () =>
    request<AiCredentialStatus>('/auth/ai-credentials/codex', {
      method: 'DELETE',
    }),
  listPersonalApiTokens: (query?: ListQuery) => requestPage<PersonalApiTokenMeta>('/auth/personal-api-tokens', query),
  createPersonalApiToken: (payload: { name: string }) =>
    request<PersonalApiTokenCreated>('/auth/personal-api-tokens', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokePersonalApiToken: (id: string) =>
    request<{ ok: boolean }>(`/auth/personal-api-tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getGithubCredentialStatus: () =>
    request<GitCredentialStatus>('/auth/git-credentials/github'),
  upsertGithubCredential: (payload: { accessToken: string }) =>
    request<GitCredentialStatus>('/auth/git-credentials/github', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteGithubCredential: () =>
    request<GitCredentialStatus>('/auth/git-credentials/github', {
      method: 'DELETE',
    }),
  getGitlabCredentialStatus: () =>
    request<GitCredentialStatus>('/auth/git-credentials/gitlab'),
  upsertGitlabCredential: (payload: { accessToken: string }) =>
    request<GitCredentialStatus>('/auth/git-credentials/gitlab', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteGitlabCredential: () =>
    request<GitCredentialStatus>('/auth/git-credentials/gitlab', {
      method: 'DELETE',
    }),
  getRequirements: (query?: ListQuery) => requestPage<Requirement>('/requirements', query),
  createRequirement: (payload: RequirementPayload) =>
    request<Requirement>('/requirements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getRequirement: (id: string) => request<Requirement>(`/requirements/${id}`),
  getRequirementRepositories: (id: string, query?: ListQuery) => requestPage<Repository>(`/requirements/${id}/repositories`, query),
  getWorkflowHistory: (id: string, query?: ListQuery) => requestPage<WorkflowRun['stageExecutions'][number]>(`/workflow-runs/${id}/history`, query),
  getWorkflowRepositories: (id: string, query?: ListQuery) => requestPage<WorkflowRun['workflowRepositories'][number]>(`/workflow-runs/${id}/repositories`, query),
  getRequirementIdeationSessions: (id: string, query?: ListQuery) => requestPage<NonNullable<Requirement['ideationSessions']>[number]>(`/requirements/${id}/ideation/sessions`, query),
  getRequirementIdeationArtifacts: (id: string, query?: ListQuery) => requestPage<NonNullable<Requirement['ideationArtifacts']>[number]>(`/requirements/${id}/ideation/artifacts`, query),
  getRequirementChanges: (id: string, workflowRunId?: string, query?: ListQuery) => request<PageResult<RequirementChange> & Omit<RequirementChanges, 'changes'>>(`/requirements/${id}/changes${queryString({ page: 1, pageSize: 20, ...query, workflowRunId })}`),
  createRequirementChange: (id: string, payload: RequirementChangePayload) =>
    request<RequirementChange>(`/requirements/${id}/changes`, { method: 'POST', body: JSON.stringify(payload) }),
  createPrototypeRequirementChange: (id: string, payload: RequirementChangePayload & { aiProvider?: 'codex' | 'cursor' }, file: File) => {
    const body = new FormData(); body.append('file', file);
    body.append('content', payload.content); body.append('mode', payload.mode); body.append('requestId', payload.requestId);
    if (payload.sourceWorkflowRunId) body.append('sourceWorkflowRunId', payload.sourceWorkflowRunId);
    if (payload.aiProvider) body.append('aiProvider', payload.aiProvider);
    return request<RequirementChange>(`/requirements/${id}/changes/prototype`, { method: 'POST', body });
  },
  downloadRequirementChangePrototype: (id: string, changeId: string) =>
    request<Blob>(`/requirements/${id}/changes/${changeId}/source`, undefined, 'blob'),
  restartRequirementChange: (id: string, changeId: string) =>
    request<RequirementChange>(`/requirements/${id}/changes/${changeId}/restart`, { method: 'POST' }),
  deleteRequirement: (id: string) =>
    request<{ success: boolean }>(`/requirements/${id}`, { method: 'DELETE' }),
  updateRequirement: (
    id: string,
    payload: {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      functionalModule?: string;
      riskImpact?: string;
      productRequirementDocument?: string;
      remark?: string;
      priority?: string;
      planningStatus?: string;
      versionId?: string | null;
    },
  ) =>
    request<Requirement>(`/requirements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  getRequirementAssignments: (id: string, query?: ListQuery) => requestPage<RequirementAssignment>(`/requirements/${id}/assignments`, query),
  createRequirementAssignment: (
    id: string,
    payload: {
      userId: string;
      role: string;
      plannedStartDate: string;
      plannedEndDate: string;
      note?: string;
      sortOrder?: number;
      colorToken?: string;
    },
  ) =>
    request<RequirementAssignment>(`/requirements/${id}/assignments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRequirementAssignment: (
    id: string,
    assignmentId: string,
    payload: {
      userId: string;
      role: string;
      plannedStartDate: string;
      plannedEndDate: string;
      note?: string;
      sortOrder?: number;
      colorToken?: string;
    },
  ) =>
    request<RequirementAssignment>(`/requirements/${id}/assignments/${assignmentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteRequirementAssignment: (id: string, assignmentId: string) =>
    request<{ ok: boolean }>(`/requirements/${id}/assignments/${assignmentId}`, {
      method: 'DELETE',
    }),
  getScheduleGantt: (query: {
    page?: number; pageSize?: number;
    view?: 'requirement' | 'member';
    scope?: 'project' | 'organization';
    projectId?: string;
    from: string;
    to: string;
    userId?: string;
    onlyMe?: boolean;
    requirementId?: string;
    role?: string;
  }) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      if (key === 'onlyMe') {
        params.set('onlyMe', value ? 'true' : 'false');
        return;
      }
      params.set(key, String(value));
    });
    return request<GanttPayload>(`/schedule/gantt?${params.toString()}`);
  },
  startBrainstorm: (requirementId: string, hint?: string) =>
    request<Requirement>(`/requirements/${requirementId}/brainstorm/run`, {
      method: 'POST',
      body: JSON.stringify({ humanHint: hint }),
    }),
  reviseBrainstorm: (requirementId: string, feedback: string) =>
    request<Requirement>(`/requirements/${requirementId}/brainstorm/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmBrainstorm: (requirementId: string) =>
    request<Requirement>(`/requirements/${requirementId}/brainstorm/confirm`, {
      method: 'POST',
    }),
  runBrainstorm: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/brainstorm/run`, { method: 'POST' }),
  skipBrainstorm: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/brainstorm/skip`, { method: 'POST' }),
  runDesign: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/design/run`, { method: 'POST' }),
  skipDesign: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/design/skip`, { method: 'POST' }),
  runDemo: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/demo/run`, { method: 'POST' }),
  reviseDemo: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/demo/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmDemo: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/demo/confirm`, { method: 'POST' }),
  skipDemo: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/demo/skip`, { method: 'POST' }),
  reviseWorkflowDesign: (workflowRunId: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${workflowRunId}/design/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmWorkflowDesign: (workflowRunId: string) =>
    request<WorkflowRun>(`/workflow-runs/${workflowRunId}/design/confirm`, { method: 'POST' }),
  rejectWorkflowDesign: (workflowRunId: string) =>
    request<WorkflowRun>(`/workflow-runs/${workflowRunId}/design/reject`, { method: 'POST' }),
  startDesign: (requirementId: string, hint?: string) =>
    request<Requirement>(`/requirements/${requirementId}/design/run`, {
      method: 'POST',
      body: JSON.stringify({ humanHint: hint }),
    }),
  reviseDesign: (requirementId: string, feedback: string) =>
    request<Requirement>(`/requirements/${requirementId}/design/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmDesign: (requirementId: string) =>
    request<Requirement>(`/requirements/${requirementId}/design/confirm`, {
      method: 'POST',
    }),
  startDemoGeneration: (requirementId: string, hint?: string) =>
    request<Requirement>(`/requirements/${requirementId}/demo/run`, {
      method: 'POST',
      body: JSON.stringify({ humanHint: hint }),
    }),
  reviseDemoGeneration: (requirementId: string, feedback: string) =>
    request<Requirement>(`/requirements/${requirementId}/demo/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmDemoGeneration: (requirementId: string) =>
    request<Requirement>(`/requirements/${requirementId}/demo/confirm`, {
      method: 'POST',
    }),
  getIdeationSessionEvents: (requirementId: string, sessionId: string, query?:ListQuery) =>
    requestPage<IdeationSessionEvent>(`/requirements/${requirementId}/ideation/sessions/${sessionId}/events`,query),
  detectLocalDev: (repositoryId: string, workflowRunId?: string) =>
    request<LocalDevDetectResponse>(
      `/repositories/${repositoryId}/local-dev${workflowRunId ? `?workflowRunId=${encodeURIComponent(workflowRunId)}` : ''}`,
    ),
  getLocalDevStatus: (repositoryId: string, workflowRunId?: string) =>
    request<LocalDevPreviewStatus>(
      `/repositories/${repositoryId}/local-dev/status${workflowRunId ? `?workflowRunId=${encodeURIComponent(workflowRunId)}` : ''}`,
    ),
  startLocalDevPreview: (repositoryId: string, workflowRunId?: string) =>
    request<LocalDevPreviewStatus>(
      `/repositories/${repositoryId}/local-dev/start${workflowRunId ? `?workflowRunId=${encodeURIComponent(workflowRunId)}` : ''}`,
      { method: 'POST' },
    ),
  stopLocalDevPreview: (repositoryId: string, workflowRunId?: string) =>
    request<LocalDevPreviewStatus>(
      `/repositories/${repositoryId}/local-dev/stop${workflowRunId ? `?workflowRunId=${encodeURIComponent(workflowRunId)}` : ''}`,
      { method: 'POST' },
    ),
  finalizeIdeation: (requirementId: string) =>
    request<Requirement>(`/requirements/${requirementId}/ideation/finalize`, {
      method: 'POST',
    }),
  getWorkflowRuns: (query?: ListQuery) => requestPage<WorkflowRun>('/workflow-runs', query),
  getWorkflowRun: (id: string) => request<WorkflowRun>(`/workflow-runs/${id}`),
  getCodeDeliveryHistory: (id:string,query?:ListQuery) => requestPage<WorkflowCodeDelivery['history'][number]>(`/workflow-runs/${id}/code-delivery/history`,query),
  getCodeDelivery: (id: string) => request<WorkflowCodeDelivery>(`/workflow-runs/${id}/code-delivery`),
  submitCodeBranch: (id: string, body: { workflowRepositoryId: string; branch: string }) =>
    request<WorkflowCodeDelivery>(`/workflow-runs/${id}/code-delivery/branches`, { method: 'POST', body: JSON.stringify(body) }),
  confirmCodeDelivery: (id: string, body: { confirmed: true; submissions: Array<{ id: string; headSha: string }> }) =>
    request<WorkflowCodeDelivery>(`/workflow-runs/${id}/code-delivery/confirm`, { method: 'POST', body: JSON.stringify(body) }),

  getWorkflowCollaboration: (id: string) =>
    request<WorkflowCollaboration>(`/workflow-runs/${id}/collaboration`),
  releaseWorkflowLocalTask: (id: string, payload: {
    executionSessionId: string; confirmedStopped: true; reason: string;
  }) => request<{ released: boolean }>(`/workflow-runs/${id}/local-task/release`, {
    method: 'POST', body: JSON.stringify(payload),
  }),
  listExecutionSessions: (params: { projectId?: string; workflowRunId?: string; status?: ExecutionSessionStatus; sourceTool?: SourceTool; claimedByUserId?: string; search?: string; view?: ExecutionSessionView; page?: number; since?: string; until?: string; cursor?: string; take?: number } = {}) =>
    request<ExecutionSessionsPage>(`/execution-sessions${queryString({ ...params,
      page: params.page === undefined ? undefined : String(params.page),
      take: params.take === undefined ? undefined : String(params.take) })}`),
  requestExecutionCommand: (id: string, commandType: ExecutionCommandType, idempotencyKey: string) =>
    request<ExecutionCommand>(`/execution-sessions/${encodeURIComponent(id)}/commands`, {
      method: 'POST', body: JSON.stringify({ commandType, idempotencyKey }),
    }),
  retryExecutionSession: (id: string, sourceTool: 'cursor' | 'codex') =>
    request<{ executionSessionId: string; workflowRunId: string }>(`/execution-sessions/${encodeURIComponent(id)}/retry`, {
      method: 'POST', body: JSON.stringify({ previousExecutionStopped: true, sourceTool }),
    }),
  getExecutionSession: (id: string) =>
    request<ExecutionSessionDetail>(`/execution-sessions/${id}`),
  listExecutionSessionEvidence: (id: string, query?:ListQuery) =>
    requestPage<ExecutionSessionEvidence>(`/execution-sessions/${id}/evidence`,query),
  listExecutionSessionEvents: (id:string, query:ListQuery & {view?:'progress'} = {}) =>
    requestPage<ExecutionSessionSyncEvent>(`/execution-sessions/${id}/events`,query),
  listWorkflowDesignArtifacts: (id: string) =>
    request<WorkflowDesignArtifactsList>(`/workflow-runs/${id}/design-artifacts`),
  getWorkflowDesignArtifactPage: (id: string, surfaceId: string, pageId: string) =>
    request<WorkflowDesignArtifactPage>(
      `/workflow-runs/${id}/design-artifacts/page${queryString({ surfaceId, pageId })}`,
    ),
  startOpenDesignHandoff: (requirementId: string, repositoryIds?: string[]) =>
    request<OpenDesignHandoffResponse>('/edge/design-handoffs', {
      method: 'POST',
      body: JSON.stringify({ requirementId, repositoryIds }),
    }),
  retryOpenDesignHandoff: (workflowRunId: string) =>
    request<OpenDesignHandoffResponse>(`/edge/design-handoffs/${workflowRunId}/retry`, {
      method: 'POST',
    }),
  retryOpenDesignBrainstormHandoff: (workflowRunId: string) =>
    request<OpenDesignHandoffResponse>(`/edge/brainstorm-handoffs/${workflowRunId}/retry`, {
      method: 'POST',
    }),
  getOpenDesignHandoff: (workflowRunId: string) =>
    request<OpenDesignHandoff>(`/workflow-runs/${workflowRunId}/design/local-handoff`),
  getOpenDesignBrainstormHandoff: (workflowRunId: string) =>
    request<OpenDesignHandoff>(`/workflow-runs/${workflowRunId}/brainstorm/local-handoff`),
  fetchPlanArtifact: async (id: string) => {
    const token = getAuthToken();
    const response = await fetch(buildApiUrl(`/workflow-runs/${id}/artifacts/plan`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('Artifact not found');
    }
    return response.text();
  },
  fetchExecutionArtifact: async (id: string) => {
    const token = getAuthToken();
    const response = await fetch(buildApiUrl(`/workflow-runs/${id}/artifacts/execution`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error('Artifact not found');
    }
    return response.text();
  },
  claimLocalExecution: (id: string) =>
    request<LocalExecutionClaimResponse>(`/workflow-runs/${id}/execution/claim-local`, {
      method: 'POST',
    }),
  issueLocalLaunchTicket: (id: string) =>
    request<{ ticket: string; expiresAt: string; loopbackPort: number }>(
      `/workflow-runs/${id}/execution/local-launch-ticket`,
      { method: 'POST' },
    ),
  issueSpecPlanLocalLaunchTicket: (id: string) =>
    request<{ ticket: string; expiresAt: string; loopbackPort: number }>(
      `/workflow-runs/${id}/spec-plan/local-launch-ticket`,
      { method: 'POST' },
    ),
  claimLocalSpecPlan: (id: string) =>
    request<LocalSpecPlanClaimResponse>(`/workflow-runs/${id}/spec-plan/claim-local`, {
      method: 'POST',
    }),
  getLocalHandoff: (id: string) =>
    request<LocalHandoffPayload>(`/workflow-runs/${id}/execution/local-handoff`),
  completeLocalExecution: (
    id: string,
    body: { pushed: boolean; repositories: CompleteLocalRepositoryReport[] },
  ) =>
    request<LocalExecutionClaimResponse>(`/workflow-runs/${id}/execution/complete-local`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  completeExecutionSession: (id: string, body: { pushed: boolean; repositories: CompleteLocalRepositoryReport[] }) =>
    request<ExecutionSessionDetail>(`/execution-sessions/${encodeURIComponent(id)}/complete`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  cancelLocalExecution: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/execution/cancel-local`, { method: 'POST' }),
  deleteWorkflowRun: (id: string) =>
    request<{ success: boolean }>(`/workflow-runs/${id}`, { method: 'DELETE' }),
  rollbackWorkflowToPreviousStage: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/rollback`, { method: 'POST' }),
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
  createWorkflowRun: (
    requirementId: string,
    repositoryIds?: string[],
    aiProvider?: 'codex' | 'cursor',
  ) =>
    request<WorkflowRun>('/workflow-runs', {
      method: 'POST',
      body: JSON.stringify({ requirementId, repositoryIds, aiProvider }),
    }),
  runSpecPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/run`, { method: 'POST' }),
  reviseSpecPlan: (id: string, feedback: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  confirmSpecPlan: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/confirm`, { method: 'POST' }),
  rejectSpecPlan: (id: string, feedback?: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/reject`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),
  manualEditSpecPlan: (id: string, output: SpecPlanOutput) =>
    request<WorkflowRun>(`/workflow-runs/${id}/spec-plan/manual-edit`, {
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
  runReview: (id: string, aiProvider?: 'codex' | 'cursor') =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/run`, {
      method: 'POST',
      body: JSON.stringify({ aiProvider }),
    }),
  skipReview: (id: string) =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/skip`, { method: 'POST' }),
  getReviewFindings: (workflowRunId: string, query?: ListQuery) => requestPage<ReviewFinding>(`/workflow-runs/${workflowRunId}/review-findings`, query),
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
  getIssues: (query?: ListQuery) => requestPage<Issue>('/issues', query),
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
  getBugs: (query?: ListQuery) => requestPage<Bug>('/bugs', query),
  getTestCaseLibraries: (query: ListQuery & { workspaceId: string }) => requestPage<TestCaseLibrary>('/quality/case-libraries', query),
  getTestCaseModules: (libraryId: string, query?: ListQuery) => requestPage<TestCaseModule>(`/quality/case-libraries/${libraryId}/modules`, query),
  createTestCaseModule: (
    libraryId: string,
    payload: { name: string; parentId?: string; sortOrder?: number },
  ) =>
    request<TestCaseModule>(`/quality/case-libraries/${libraryId}/modules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTestCaseModule: (
    id: string,
    payload: { name?: string; parentId?: string | null; sortOrder?: number },
  ) =>
    request<TestCaseModule>(`/quality/test-case-modules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTestCaseModule: (id: string) =>
    request<{ success: true; affectedCases: number }>(`/quality/test-case-modules/${id}`, {
      method: 'DELETE',
    }),
  createTestCaseLibrary: (payload: { workspaceId: string; projectId?: string; name: string }) =>
    request<TestCaseLibrary>('/quality/case-libraries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTestCases: (query: ListQuery & { workspaceId: string }) => requestPage<TestCaseDefinition>('/quality/test-cases', query),
  getTestCasesPage: (query: ListQuery & { workspaceId: string }) => requestPage<TestCaseDefinition>('/quality/test-cases', query),
  getTestDesignCandidates: (id: string, query?: ListQuery) => requestPage<TestDesignCandidate>(`/quality/test-designs/${id}/candidates`, query),
  getTestDesignSmokeCases: (id: string, query?: ListQuery) => requestPage<TestDesign['smokeCases'][number]>(`/quality/test-designs/${id}/smoke-cases`, query),
  getTestRequestSnapshots: (id: string, query?: ListQuery) => requestPage<NonNullable<TestRequest['testPlan']>['snapshots'][number]>(`/quality/test-requests/${id}/snapshots`, query),
  getTestRunCases: (id: string, query?: ListQuery) => requestPage<NonNullable<TestRun['cases']>[number]>(`/quality/test-runs/${id}/cases`, query),
  getTestRunExecutions: (id: string, query?: ListQuery) => requestPage<NonNullable<TestRun['executions']>[number]>(`/quality/test-runs/${id}/executions`, query),
  getTestRunTargets: (id: string, query?: ListQuery) => requestPage<NonNullable<TestRun['targets']>[number]>(`/quality/test-runs/${id}/targets`, query),
  getTestRequestCases: (id: string, query?: ListQuery) => requestPage<NonNullable<TestRun['cases']>[number] & { testRun: { id: string; name: string; status: string; runType: string } }>(`/quality/test-requests/${id}/cases`, query),
  getQualityReportBaselines: (id: string, query?: ListQuery) => requestPage<TestedRepositoryRevision>(`/quality/test-requests/${id}/report-baselines`, query),
  getQualityReportSupersessions: (id: string, query?: ListQuery) => requestPage<QualitySupersession & { label: string }>(`/quality/test-requests/${id}/report-supersessions`, query),
  getTestRequestRequirements: (id: string, query?: ListQuery) => requestPage<TestRequest['requirementLinks'][number]>(`/quality/test-requests/${id}/requirements`, query),
  getTestRequestWorkflows: (id: string, query?: ListQuery) => requestPage<TestRequest['workflowLinks'][number]>(`/quality/test-requests/${id}/workflows`, query),
  getTestRequestArtifacts: (id: string, query?: ListQuery) => requestPage<TestRequest['artifactLinks'][number]>(`/quality/test-requests/${id}/artifacts`, query),
  getTestDesignRequirements: (id: string, query?: ListQuery) => requestPage<NonNullable<TestDesign['requirements']>[number]>(`/quality/test-designs/${id}/requirements`, query),
  getTestDesignWorkflows: (id: string, query?: ListQuery) => requestPage<NonNullable<TestDesign['workflowRuns']>[number]>(`/quality/test-designs/${id}/workflows`, query),
  createTestCase: (
    libraryId: string,
    payload: {
      moduleId?: string;
      externalId?: string;
      title: string;
      priority?: string;
      precondition?: string;
      testData?: string;
      targetKeys?: string[];
      steps: string[];
      expected: string;
      tags?: string[];
    },
  ) =>
    request<TestCaseDefinition>(`/quality/case-libraries/${libraryId}/cases`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTestCase: (
    id: string,
    payload: {
      libraryId?: string;
      moduleId?: string | null;
      externalId?: string | null;
      title?: string;
      priority?: string;
      precondition?: string | null;
      testData?: string | null;
      targetKeys?: string[];
      steps?: string[];
      expected?: string;
      tags?: string[];
    },
  ) =>
    request<TestCaseDefinition>(`/quality/test-cases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  importTestCases: (libraryId: string, cases: TestCaseImportRow[], autoCreateModules = false) =>
    request<{ imported: number }>(`/quality/case-libraries/${libraryId}/cases/import`, {
      method: 'POST',
      body: JSON.stringify({ cases, autoCreateModules }),
    }),
  deleteTestCase: (id: string) =>
    request<{ success: true }>(`/quality/test-cases/${id}`, { method: 'DELETE' }),
  getTestRequests: (query?: ListQuery) => requestPage<TestRequest>('/quality/test-requests', query),
  createTestRequest: (payload: {
    workspaceId: string;
    projectId: string;
    projectVersionId: string;
    title: string;
    description?: string;
    requirementIds: string[];
    workflowRunIds: string[];
    artifactIds?: string[];
    testDesignId?: string;
  }) =>
    request<TestRequest>('/quality/test-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  prepareTestRequest: (id: string, payload: { scopeRevision: number }) =>
    request<TestRequest>(`/quality/test-requests/${id}/prepare`, { method: 'POST', body: JSON.stringify(payload) }),
  getTestRequestScopeDraft: (id: string, query?: ListQuery & { action?: string }) => request<TestRequestScopeDraft>(`/quality/test-requests/${id}/scope-draft?${queryString({ page: 1, pageSize: 20, ...query })}`),
  updateTestRequestScopeDraft: (id: string, payload: { scopeRevision: number; removedCandidateIds: string[] }) => request<TestRequest>(`/quality/test-requests/${id}/scope-draft`, { method: 'PATCH', body: JSON.stringify(payload) }),
  addTestRequestScopeDraftCases: (id: string, payload: { selections: Array<{ caseId: string; reason: string; impactLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }> }) => request<TestRequest>(`/quality/test-requests/${id}/scope-draft/cases`, { method: 'POST', body: JSON.stringify(payload) }),
  saveGeneratedTestRequestCase: (id: string, candidateId: string, payload: { libraryId: string; moduleId?: string }) => request<{ candidateId: string; testCase: TestCaseDefinition }>(`/quality/test-requests/${id}/scope-draft/${candidateId}/save-to-library`, { method: 'POST', body: JSON.stringify(payload) }),
  getTestRequestAssignments: (id: string, query?: ListQuery & { unassigned?: string }) => request<TestRequestAssignmentsPage>(`/quality/test-requests/${id}/assignments?${queryString({ page: 1, pageSize: 20, ...query })}`),
  updateTestRequestAssignments: (id: string, payload: { scopeRevision: number; assignments: Array<{ snapshotId: string; assignedToUserId?: string | null }> }) => request<TestRequestAssignmentsPage>(`/quality/test-requests/${id}/assignments`, { method: 'PATCH', body: JSON.stringify(payload) }),
  completeTestRequestAssignments: (id: string, payload: { scopeRevision: number }) => request<TestRequest>(`/quality/test-requests/${id}/assignments/complete`, { method: 'POST', body: JSON.stringify(payload) }),
  getTestRequest: (id: string) => request<TestRequest>(`/quality/test-requests/${id}`),
  createTestDesign: (payload: {
    caseSelection?: QualityCaseSelection;
    workspaceId: string;
    projectId: string;
    projectVersionId: string;
    requirementIds: string[];
    workflowRunIds: string[];
    changeSummary?: string;
  }) => request<TestDesign>('/quality/test-designs', { method: 'POST', body: JSON.stringify(payload) }),
  getTestDesigns: (query?: ListQuery) => requestPage<TestDesign>('/quality/test-designs', query),
  getTestDesign: (id: string) => request<TestDesign>(`/quality/test-designs/${id}`),
  generateTestDesign: (id: string) => request<TestDesign>(`/quality/test-designs/${id}/generate`, { method: 'POST' }),
  updateTestDesignCandidate: (id: string, candidateId: string, payload: Record<string, unknown>) =>
    request<TestDesignCandidate>(`/quality/test-designs/${id}/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateTestDesignSmoke: (id: string, payload: Record<string, unknown>) =>
    request<TestDesign>(`/quality/test-designs/${id}/smoke`, { method: 'PATCH', body: JSON.stringify(payload) }),
  confirmTestDesign: (id: string, payload: Record<string, unknown>) =>
    request<TestDesign>(`/quality/test-designs/${id}/confirm`, { method: 'POST', body: JSON.stringify(payload) }),
  updateQualitySelection: (id: string, payload: { revision: number; caseSelection: QualityCaseSelection }) =>
    request<TestDesign>(`/quality/test-designs/${id}/selection`, { method: 'PATCH', body: JSON.stringify(payload) }),
  addQualityCandidates: (id: string, payload: { revision: number; definitionIds: string[] }) =>
    request<TestDesign>(`/quality/test-designs/${id}/candidates`, { method: 'POST', body: JSON.stringify(payload) }),
  getTestRun: (id: string) => request<TestRun>(`/quality/test-runs/${id}`),
  getQualityCapabilities: () => request<{ capabilities: string[] }>('/quality/capabilities'),
  createTestRun: (requestId: string, payload: CreateManualTestRunInput) =>
    request<TestRun>(`/quality/test-requests/${requestId}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reportTestResult: (
    testRunCaseId: string,
    payload: { result: 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED'; actualResult?: string; remark?: string },
  ) => request<{ result: NonNullable<TestRun['cases']>[number]['result']; runStatus: string; testRequestStatus: string }>(
    `/quality/test-run-cases/${testRunCaseId}/result`,
    { method: 'POST', body: JSON.stringify(payload) },
  ),
  createLocalTestRun: (requestId: string, payload: CreateLocalTestRunInput) =>
    request<TestRun>(`/quality/test-requests/${requestId}/local-test-runs`, { method: 'POST', body: JSON.stringify(payload) }),
  issueQualityLocalLaunchTicket: (id: string, payload: { targetId: string; caseIds?: string[]; preferredIde?: 'cursor' | 'codex' | 'workbuddy' }) =>
    request<{ ticket: string; expiresAt: string; loopbackPort: number }>(`/quality/test-runs/${id}/local-launch`, { method: 'POST', body: JSON.stringify(payload) }),
  finishQualityRun: (id: string, payload: { revision: number; reason?: string }) =>
    request<TestRun>(`/quality/test-runs/${id}/finish`, { method: 'POST', body: JSON.stringify(payload) }),
  controlQualityExecution: (sessionId: string, action: 'heartbeat' | 'release' | 'cancel', payload: { leaseSeconds?: number; reason?: string }) =>
    request<{ status: string; deviceStopped?: boolean; leaseExpiresAt?: string }>(`/execution-sessions/${sessionId}/quality/${action}`, { method: 'POST', body: JSON.stringify(payload) }),
  linkQualityCaseBug: (id: string, caseId: string, bugId: string) =>
    request<NonNullable<TestRun['cases']>[number]>(`/quality/test-runs/${id}/cases/${caseId}/bug`, { method: 'POST', body: JSON.stringify({ bugId }) }),
  getQualityReports: (requestId: string, query?: ListQuery) => requestPage<QualityTestReport>(`/quality/test-requests/${requestId}/reports`, query),
  createQualityRunReport: (runId: string, payload: QualityReportInput) =>
    request<QualityTestReport>(`/quality/test-runs/${runId}/reports`, { method: 'POST', body: JSON.stringify(payload) }),
  createQualityRequestReport: (requestId: string, payload: QualityRequestReportInput) =>
    request<QualityTestReport>(`/quality/test-requests/${requestId}/reports`, { method: 'POST', body: JSON.stringify(payload) }),
  getTestRuns: (testRequestId: string, query?: ListQuery) => requestPage<TestRun>(`/quality/test-requests/${testRequestId}/runs`, query),
  getTestRequestRuns: (testRequestId: string, query?: ListQuery) => requestPage<TestRun>(`/quality/test-requests/${testRequestId}/runs`, query),
  getTestRunsPage: (query?: ListQuery) => requestPage<TestRun & { testRequest: TestRequest }>('/quality/test-runs', query),
  getLocalSmokeRuns: (testRequestId: string, query?: ListQuery) => requestPage<TestRun>(`/quality/test-requests/${testRequestId}/local-smoke-runs`, query),
  getLocalSmokeTasks: (testRunId: string) =>
    request<TestRun>(`/quality/local-smoke-runs/${testRunId}/tasks`),
  createLocalSmokeRun: (
    testRequestId: string,
    payload: {
      name: string;
      targets: Array<{
        key: string;
        name: string;
        required?: boolean;
        expectedRevisions: TestedRepositoryRevision[];
      }>;
      snapshotIds?: string[];
    },
  ) =>
    request<TestRun>(`/quality/test-requests/${testRequestId}/local-smoke-runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  finalizeLocalSmokeRun: (testRunId: string) =>
    request<{ testRunId: string; status: string; reportRevision: number; artifact: ArtifactSummary }>(
      `/quality/local-smoke-runs/${testRunId}/finalize`,
      { method: 'POST' },
    ),
  getSubmissionReport: (testRequestId: string) =>
    request<ArtifactSummary | null>(`/quality/test-requests/${testRequestId}/submission-report`),
  fetchArtifactContent: async (artifactId: string) => {
    const token = getAuthToken();
    const response = await fetch(buildApiUrl(`/artifacts/${encodeURIComponent(artifactId)}/content`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('资料下载失败');
    return response.blob();
  },
  createBug: (payload: {
    workspaceId: string;
    projectId?: string;
    title: string;
    description: string;
    severity?: string;
    priority?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
    reproductionSteps?: string[];
    repositoryId?: string;
    branchName?: string;
    screenshots?: Array<{
      fileName: string;
      contentType: string;
      dataBase64: string;
    }>;
  }) =>
    request<Bug>('/bugs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  startBugFixWorkflow: (
    bugId: string,
    payload?: {
      repositoryIds?: string[];
      aiProvider?: 'codex' | 'cursor';
      autoStart?: boolean;
    },
  ) =>
    request<{ bug: Bug; requirement: { id: string; title: string }; workflowRun: WorkflowRun }>(
      `/bugs/${bugId}/fix-workflow`,
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
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
      screenshots?: Array<{
        fileName: string;
        contentType: string;
        dataBase64: string;
      }>;
    },
  ) =>
    request<Bug>(`/bugs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  reviseReview: (id: string, feedback: string, aiProvider?: 'codex' | 'cursor') =>
    request<WorkflowRun>(`/workflow-runs/${id}/review/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback, aiProvider }),
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
