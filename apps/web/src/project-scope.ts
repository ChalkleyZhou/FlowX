export const CURRENT_PROJECT_STORAGE_KEY = 'flowx-current-project';

export const PROJECT_LIST_PATHS = [
  '/dashboard',
  '/requirements',
  '/workflow-runs',
  '/briefings',
  '/code-reviews',
  '/quality/test-requests',
  '/quality/test-cases',
  '/quality/test-runs',
  '/schedule',
  '/bugs',
  '/project-settings',
] as const;

const DETAIL_TO_LIST: Array<[RegExp, string]> = [
  [/^\/requirements\/[^/]+$/, '/requirements'],
  [/^\/workflow-runs\/[^/]+$/, '/workflow-runs'],
  [/^\/briefings\/[^/]+$/, '/briefings'],
  [/^\/daily-code-reviews\/[^/]+$/, '/code-reviews'],
  [/^\/execution-sessions\/[^/]+$/, '/dashboard'],
  [/^\/quality\/test-requests\/[^/]+$/, '/quality/test-requests'],
  [/^\/quality\/test-designs\/[^/]+$/, '/quality/test-requests'],
  [/^\/quality\/test-runs\/[^/]+$/, '/quality/test-runs'],
  [/^\/bugs\/[^/]+$/, '/bugs'],
];

export const PROJECT_DEPENDENT_QUERY_KEYS = [
  'versionId',
  'requirementId',
  'libraryId',
  'projectVersionId',
  'workflowRunId',
  'workspaceId',
  'caseScope',
  'page',
  'create',
] as const;

export function readCurrentProjectId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const value = window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
    return value || null;
  } catch {
    return null;
  }
}

export function writeCurrentProjectId(projectId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (projectId) {
      window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, projectId);
    } else {
      window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
    }
  } catch {
    // 本机存储不可用时仍以地址栏为准。
  }
}

export function isProjectScopedListPath(pathname: string) {
  return (PROJECT_LIST_PATHS as readonly string[]).includes(pathname);
}

export function listPathForProjectSwitch(pathname: string): string | null {
  if (isProjectScopedListPath(pathname)) {
    return pathname;
  }
  for (const [pattern, listPath] of DETAIL_TO_LIST) {
    if (pattern.test(pathname)) {
      return listPath;
    }
  }
  return null;
}

export function withCurrentProject(path: string, projectId: string | null) {
  if (!projectId) {
    return path;
  }
  const pathname = path.split('?')[0];
  if (!isProjectScopedListPath(pathname) && pathname !== '/quality') {
    return path;
  }
  return `${pathname}?projectId=${encodeURIComponent(projectId)}`;
}

/** 在项目级页面切换项目时留在同类列表，并清掉依赖旧项目的筛选项。组织级页面返回 null，调用方只更新当前项目。 */
export function buildProjectSwitchLocation(pathname: string, search: string, projectId: string): string | null {
  const listPath = listPathForProjectSwitch(pathname);
  if (!listPath) {
    return null;
  }
  const params = new URLSearchParams(isProjectScopedListPath(pathname) ? search : '');
  for (const key of PROJECT_DEPENDENT_QUERY_KEYS) {
    params.delete(key);
  }
  params.set('projectId', projectId);
  const query = params.toString();
  return `${listPath}${query ? `?${query}` : ''}`;
}
