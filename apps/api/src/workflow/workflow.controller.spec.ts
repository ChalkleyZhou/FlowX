import 'reflect-metadata';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
Reflect.defineMetadata('design:paramtypes', [String, Object], WorkflowController.prototype, 'getDesignArtifactPageByQuery');
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
  let proxy: Server;
  let proxyUrl: string;
  beforeAll(async () => {
    app = await NestFactory.create(DesignArtifactHttpModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    // 模拟部署代理先解码路径再移除 /api 前缀；查询字符串保持原样。
    proxy = createServer((req, res) => {
      const incoming = new URL(req.url!, 'http://localhost');
      const path = encodeURI(decodeURIComponent(incoming.pathname).replace(/^\/api/, ''));
      const upstream = httpRequest(`${baseUrl}${path}${incoming.search}`, { method: req.method }, response => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502).end(); });
      req.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/api`;
  });
  beforeEach(() => {
    getWorkflowDesignArtifactPage.mockReset().mockImplementation(async (_id, surfaceId, pageId) => ({
      exists: true, html: '<html>原型页面</html>', surfaceId, pageId,
    }));
  });
  afterAll(async () => {
    if (proxy) await new Promise<void>((resolve, reject) => proxy.close(error => error ? reject(error) : resolve()));
    await app?.close();
  });

  it('复现旧路径接口经过代理解码后无法读取嵌套原型', async () => {
    const pageId = '巡逻防控/01_巡逻任务.html';
    const response = await fetch(`${proxyUrl}/workflow-runs/run/design-artifacts/prototype/${encodeURIComponent(pageId)}`);
    expect(response.status).toBe(404);
    expect(getWorkflowDesignArtifactPage).not.toHaveBeenCalled();
  });

  it.each([
    ['prototype', '巡逻防控_V1.3_地址与处置改造/01_巡逻防控任务.html'],
    ['prototype', 'pages/nested/100%.html'],
    ['Web%20端', 'pages/100%2F +?#.html'],
  ])('查询接口经过代理仍保留完整页面标识：%s %s', async (surfaceId, pageId) => {
    const query = new URLSearchParams({ surfaceId, pageId });
    const response = await fetch(`${proxyUrl}/workflow-runs/run/design-artifacts/page?${query}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ exists: true, surfaceId, pageId });
    expect(getWorkflowDesignArtifactPage).toHaveBeenCalledExactlyOnceWith('run', surfaceId, pageId);
  });

  it.each([
    '', '?surfaceId=prototype', '?pageId=index.html', '?surfaceId=&pageId=index.html',
    '?surfaceId=prototype&pageId=%20', '?surfaceId=prototype&surfaceId=other&pageId=index.html',
    '?surfaceId=prototype&pageId=index.html&pageId=other.html',
  ])('缺失、空白或重复查询参数返回 400：%s', async query => {
    const response = await fetch(`${baseUrl}/workflow-runs/run/design-artifacts/page${query}`);
    expect(response.status).toBe(400);
    expect(getWorkflowDesignArtifactPage).not.toHaveBeenCalled();
  });

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
