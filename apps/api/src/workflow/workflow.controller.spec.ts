import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalLaunchService } from './local-launch.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

describe('WorkflowController AI review', () => {
  it('keeps review requests without a body compatible with existing clients', () => {
    const runReview = vi.fn();
    const controller = new WorkflowController({ runReview } as never, {} as never);

    controller.runReview('run-1', undefined as never, { authSession: undefined } as never);

    expect(runReview).toHaveBeenCalledWith('run-1', undefined, undefined, undefined);
  });

  it('passes the selected provider to the review service', () => {
    const runReview = vi.fn();
    const controller = new WorkflowController({ runReview } as never, {} as never);

    controller.runReview('run-1', { aiProvider: 'codex' }, { authSession: undefined } as never);

    expect(runReview).toHaveBeenCalledWith('run-1', undefined, undefined, 'codex');
  });
});

const getWorkflowDesignArtifactPage = vi.fn();
// Vitest 不输出构造器参数元数据，显式声明真实 Controller 的依赖。
Reflect.defineMetadata('design:paramtypes', [WorkflowService, LocalLaunchService], WorkflowController);
@Module({
  controllers: [WorkflowController],
  providers: [
    { provide: WorkflowService, useValue: { getWorkflowDesignArtifactPage } },
    { provide: LocalLaunchService, useValue: {} },
  ],
})
class DesignArtifactHttpModule {}

describe('WorkflowController 设计稿页面 HTTP 路径契约', () => {
  let app: INestApplication;
  let baseUrl: string;
  beforeAll(async () => {
    app = await NestFactory.create(DesignArtifactHttpModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(() => {
    getWorkflowDesignArtifactPage.mockReset().mockImplementation(async (_id, surfaceId, pageId) => ({
      exists: true, html: '<html>原型页面</html>', surfaceId, pageId,
    }));
  });
  afterAll(async () => { await app?.close(); });

  it.each([
    ['prototype', 'pages/100%.html'],
    ['prototype', 'pages/100%20.html'],
    ['Web端', '原型导出/事项详情.html'],
    ['Web%20端', 'pages/nested/100%2F.html'],
  ])('单次 URL 编码后保留页面标识：surface=%s page=%s', async (surfaceId, pageId) => {
    const response = await fetch(`${baseUrl}/workflow-runs/run/design-artifacts/${encodeURIComponent(surfaceId)}/${encodeURIComponent(pageId)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ exists: true, surfaceId, pageId });
    expect(getWorkflowDesignArtifactPage).toHaveBeenCalledExactlyOnceWith('run', surfaceId, pageId);
  });
});
