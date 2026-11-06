type ListRequest = { method: string; path: string; get(name: string): string | undefined };
type ListResponse = { status(code: number): ListResponse; json(body: unknown): unknown };
type ListMiddleware = (request: ListRequest, response: ListResponse, next: () => void) => void;

// 仅登记已升级为分页的记录浏览路由；详情、内容下载、执行上下文和固定能力枚举不适用。
export const PAGINATED_BROWSE_ROUTES = [
  '/projects', '/projects/:id/versions', '/workspaces', '/workspaces/:id/repositories',
  '/requirements', '/requirements/:id/repositories', '/requirements/:id/changes', '/requirements/:id/assignments',
  '/requirements/:id/ideation/sessions', '/requirements/:id/ideation/artifacts', '/requirements/:id/ideation/sessions/:sessionId/events',
  '/workflow-runs', '/workflow-runs/:id/repositories', '/workflow-runs/:id/history', '/workflow-runs/:id/code-delivery/history', '/workflow-runs/:id/review-findings',
  '/bugs', '/issues', '/artifacts', '/execution-sessions', '/execution-sessions/:id/events', '/execution-sessions/:id/artifacts', '/execution-sessions/:id/evidence',
  '/auth/organization/members', '/auth/personal-api-tokens', '/briefing-sources', '/delivery-targets',
  '/projects/:id/briefing-feeds', '/projects/:id/briefings', '/briefings/:id/delivery-logs',
  '/projects/:id/code-review-feeds', '/projects/:id/daily-code-reviews', '/daily-code-reviews/:id/delivery-logs',
  '/quality/test-requests', '/quality/test-designs', '/quality/test-runs', '/quality/case-libraries', '/quality/test-cases', '/quality/local-test-tasks',
  '/quality/case-libraries/:id/modules', '/quality/test-requests/:id/runs', '/quality/test-requests/:id/local-smoke-runs',
  '/quality/test-requests/:id/reports', '/quality/test-requests/:id/snapshots', '/quality/test-requests/:id/requirements',
  '/quality/test-requests/:id/workflows', '/quality/test-requests/:id/artifacts', '/quality/test-requests/:id/cases',
  '/quality/test-requests/:id/report-baselines', '/quality/test-requests/:id/report-supersessions',
  '/quality/test-designs/:id/candidates', '/quality/test-designs/:id/smoke-cases', '/quality/test-designs/:id/requirements', '/quality/test-designs/:id/workflows',
  '/quality/test-runs/:id/cases', '/quality/test-runs/:id/targets', '/quality/test-runs/:id/executions', '/quality/test-runs/:id/tasks', '/quality/local-smoke-runs/:id/tasks',
  '/cursor-local/tasks', '/cursor-local/workflow-position', '/cursor-local/opendesign-tasks', '/edge/tasks', '/edge/opendesign-tasks',
  '/schedule/gantt', '/integrations/yunxiao/unmatched-recipients',
] as const;

const routes = PAGINATED_BROWSE_ROUTES.map(route => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}/?$`));
export function isPaginatedBrowseRoute(path: string) { return routes.some(route => route.test(path.split('?')[0])); }

export const listContractMiddleware: ListMiddleware = (request, response, next) => {
  if (request.method !== 'GET' || !isPaginatedBrowseRoute(request.path) || request.get('X-FlowX-List-Contract') === 'pagination-v1') {
    next();
    return;
  }
  response.status(426).json({
    statusCode: 426,
    code: 'PAGINATION_UPGRADE_REQUIRED',
    message: '列表接口已升级为服务端分页。请刷新或升级 FlowX 网页及 @flowx-ai/local，使用 page/pageSize 并发送 X-FlowX-List-Contract: pagination-v1；请勿把单页结果当作全部记录。',
  });
};
