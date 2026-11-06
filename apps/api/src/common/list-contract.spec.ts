import 'reflect-metadata';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listContractMiddleware, isPaginatedBrowseRoute } from './list-contract';

@Controller()
class Routes {
  @Get('projects') projects() { return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }; }
  @Get('quality/capabilities') capabilities() { return { capabilities: ['local-test-runs'] }; }
  @Get('projects/:id') detail() { return { id: 'project-1' }; }
}
@Module({ controllers: [Routes] })
class TestModule {}
let app: INestApplication;
let base: string;
beforeAll(async () => { app = await NestFactory.create(TestModule, { logger: false }); app.use(listContractMiddleware); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); });
afterAll(async () => { await app?.close(); });

describe('分页客户端升级边界', () => {
  it('旧客户端浏览列表返回可识别426，不能静默误认第一页为全量', async () => {
    const response = await fetch(`${base}/projects`);
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: 'PAGINATION_UPGRADE_REQUIRED' });
  });
  it('新版分页客户端保持正常浏览响应', async () => {
    const response = await fetch(`${base}/projects?page=2`, { headers: { 'X-FlowX-List-Contract': 'pagination-v1' } });
    expect(response.status).toBe(200); expect(await response.json()).toHaveProperty('items');
  });
  it.each(['/quality/capabilities', '/projects/project-1'])('详情与能力枚举不要求分页header %s', async path => {
    expect((await fetch(`${base}${path}`)).status).toBe(200);
  });
  it.each([
    '/projects', '/projects/p1/versions', '/workspaces/w1/repositories', '/requirements/r1/changes', '/requirements/r1/ideation/sessions/s1/events',
    '/workflow-runs/w1/history', '/execution-sessions/s1/evidence', '/quality/test-requests/r1/report-supersessions', '/quality/test-runs/r1/cases',
    '/cursor-local/tasks', '/edge/opendesign-tasks', '/schedule/gantt', '/integrations/yunxiao/unmatched-recipients', '/auth/personal-api-tokens',
  ])('升级保护覆盖记录浏览 %s', path => { expect(isPaginatedBrowseRoute(path)).toBe(true); });
  it.each(['/auth/providers', '/workflow-runs/providers', '/quality/capabilities', '/quality/test-requests/id', '/artifacts/id/content', '/integrations/yunxiao', '/briefing-sources/repository-binding'])('不拦截固定能力与详情 %s', path => { expect(isPaginatedBrowseRoute(path)).toBe(false); });
});
