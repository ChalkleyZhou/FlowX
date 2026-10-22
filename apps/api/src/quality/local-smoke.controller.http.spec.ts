import 'reflect-metadata';
import { Module, NotFoundException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSmokeController } from './local-smoke.controller';
import { LocalSmokeService } from './local-smoke.service';

const latestReport = vi.fn();

// Vitest 的转换不输出构造器元数据，显式提供真实 Controller 的依赖类型。
Reflect.defineMetadata('design:paramtypes', [LocalSmokeService], LocalSmokeController);
@Module({
  controllers: [LocalSmokeController],
  providers: [{ provide: LocalSmokeService, useValue: { latestReport } }],
})
class HttpTestModule {}

describe('LocalSmokeController submission-report HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HttpTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(() => { latestReport.mockReset(); });
  afterAll(async () => { await app?.close(); });

  it('无报告时返回可解析的 JSON null', async () => {
    latestReport.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/quality/test-requests/request-1/submission-report`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('null');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(latestReport).toHaveBeenCalledWith('request-1');
  });

  it('已有报告时保留原有报告对象契约', async () => {
    const report = { id: 'report-1', name: 'submission-report.html', artifactType: 'TEST_REPORT', version: '1' };
    latestReport.mockResolvedValue(report);
    const response = await fetch(`${baseUrl}/quality/test-requests/request-1/submission-report`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
  });

  it('提测不存在时保留 404 错误', async () => {
    latestReport.mockRejectedValue(new NotFoundException('Test request not found.'));
    const response = await fetch(`${baseUrl}/quality/test-requests/missing/submission-report`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'Test request not found.', statusCode: 404 });
  });
});
