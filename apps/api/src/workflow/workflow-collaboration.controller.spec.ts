import 'reflect-metadata';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseLocalTaskDto } from './dto/release-local-task.dto';
import { WorkflowCollaborationController } from './workflow-collaboration.controller';
import { WorkflowCollaborationService } from './workflow-collaboration.service';

const actor = { user: { id: 'user', displayName: '甲' }, organization: { id: 'org' } };
const getCollaboration = vi.fn();
const releaseLocalTask = vi.fn();
// Vitest 不输出 TypeScript 的构造器及方法参数元数据，显式提供真实 Controller 的依赖和 DTO。
Reflect.defineMetadata('design:paramtypes', [WorkflowCollaborationService], WorkflowCollaborationController);
Reflect.defineMetadata('design:paramtypes', [String, ReleaseLocalTaskDto, Object], WorkflowCollaborationController.prototype, 'releaseLocalTask');
@Module({
  controllers: [WorkflowCollaborationController],
  providers: [{ provide: WorkflowCollaborationService, useValue: { getCollaboration, releaseLocalTask } }],
})
class CollaborationHttpModule {}

describe('工作流协同 HTTP 契约', () => {
  let app: INestApplication;
  let baseUrl: string;
  beforeAll(async () => {
    app = await NestFactory.create(CollaborationHttpModule, { logger: false });
    app.use((req: { authSession?: typeof actor }, _res: unknown, next: () => void) => { req.authSession = actor; next(); });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  beforeEach(() => {
    getCollaboration.mockReset().mockResolvedValue({ workflowRunId: 'run', currentStage: 'DESIGN', sessions: [] });
    releaseLocalTask.mockReset().mockResolvedValue({ executionSessionId: 'session', released: true });
  });
  afterAll(async () => { await app?.close(); });

  it('GET 返回协同快照且传递认证身份', async () => {
    const response = await fetch(`${baseUrl}/workflow-runs/run/collaboration`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workflowRunId: 'run', currentStage: 'DESIGN', sessions: [] });
    expect(getCollaboration).toHaveBeenCalledWith('run', actor);
    expect(releaseLocalTask).not.toHaveBeenCalled();
  });

  it('POST 释放任务并 trim 交接原因', async () => {
    const response = await post({ executionSessionId: 'session', confirmedStopped: true, reason: ' 原设备已停止 ' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ executionSessionId: 'session', released: true });
    expect(releaseLocalTask).toHaveBeenCalledWith('run', expect.objectContaining({ executionSessionId: 'session', confirmedStopped: true, reason: '原设备已停止' }), actor);
  });

  it.each([
    { executionSessionId: 'session', confirmedStopped: false, reason: '停止' },
    { executionSessionId: 'session', confirmedStopped: 'true', reason: '停止' },
    { executionSessionId: 'session', reason: '停止' },
    { executionSessionId: 'session', confirmedStopped: true, reason: '   ' },
    { executionSessionId: 'session', confirmedStopped: true, reason: '字'.repeat(2001) },
    { executionSessionId: '', confirmedStopped: true, reason: '停止' },
  ])('HTTP 拒绝未确认或不完整的释放请求', async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(releaseLocalTask).not.toHaveBeenCalled();
  });

  function post(body: unknown) {
    return fetch(`${baseUrl}/workflow-runs/run/local-task/release`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  }
});
