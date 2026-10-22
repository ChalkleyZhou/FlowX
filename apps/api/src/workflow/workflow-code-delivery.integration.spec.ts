import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowCodeDeliveryService } from './workflow-code-delivery.service';
import { WorkflowCodeDeliveryController } from './workflow-code-delivery.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { LocalSmokeService } from '../quality/local-smoke.service';
const directory = mkdtempSync(join(tmpdir(), 'flowx-code-delivery-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const git = { resolveBranchHead: vi.fn(async () => head), inspectBranch: vi.fn(async () => ({ headSha: head, baseSha: base, changedFiles: ['src/index.ts'], diffStat: '1 file changed', diffText: 'diff --git a/src/index.ts b/src/index.ts\n+export const value = 1;' })) };
const workflowService = new WorkflowService(prisma as never, new WorkflowStateMachine(), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const service = new WorkflowCodeDeliveryService(prisma as never, new WorkflowStateMachine(), git as never);
Reflect.defineMetadata('design:paramtypes', [WorkflowCodeDeliveryService], WorkflowCodeDeliveryController);
@Module({ controllers: [WorkflowCodeDeliveryController], providers: [{ provide: WorkflowCodeDeliveryService, useValue: service }] })
class TestModule {}
let app: INestApplication, baseUrl: string, org: string, workspace: string, project: string, userA: string, userB: string;
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  org = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: randomUUID(), name: '分支交付' } })).id;
  workspace = (await prisma.workspace.create({ data: { name: '分支空间', organizationId: org } })).id;
  project = (await prisma.project.create({ data: { name: '交付项目', workspaceId: workspace } })).id;
  userA = (await prisma.user.create({ data: { displayName: '甲' } })).id;
  userB = (await prisma.user.create({ data: { displayName: '乙' } })).id;
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.use((req: { headers: Record<string, string>; authSession?: unknown }, _res: unknown, next: () => void) => {
    if (req.headers['x-user-id']) req.authSession = { user: { id: req.headers['x-user-id'], displayName: '成员' }, organization: { id: req.headers['x-org-id'] ?? org } }; next();
  });
  await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
}, 30_000);
afterAll(async () => { await app?.close(); await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
function actor(id = userA) { return { user: { id, displayName: '成员' }, organization: { id: org } }; }
async function pending() {
  git.resolveBranchHead.mockReset().mockResolvedValue(head);
  git.inspectBranch.mockReset().mockResolvedValue({ headSha: head, baseSha: base, changedFiles: ['src/index.ts'], diffStat: '1 file changed', diffText: 'diff --git a/src/index.ts b/src/index.ts\n+export const value = 1;' });
  const requirement = await prisma.requirement.create({ data: { title: '分支交付', description: '', acceptanceCriteria: '', workspaceId: workspace, projectId: project } });
  const run = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'EXECUTION_PENDING', currentStage: 'EXECUTION' } });
  await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '交付功能' }, plan: { approach: '实现' } } } });
  const repo = await prisma.workflowRepository.create({ data: { workflowRunId: run.id, name: 'web', url: 'https://example.com/web.git', baseBranch: 'main', workingBranch: 'old', localPath: '/old/checkout' } });
  return { run, repo };
}
function post(id: string, path: string, body: unknown, userId = userA, organizationId = org) { return fetch(`${baseUrl}/workflow-runs/${id}/code-delivery/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': userId, 'x-org-id': organizationId }, body: JSON.stringify(body) }); }
async function submit(id: string, repoId: string, userId = userA, branch = 'feature/web') { return service.submitBranch(id, { workflowRepositoryId: repoId, branch }, actor(userId)); }
function selection(view: Awaited<ReturnType<typeof service.getDelivery>>) { return { confirmed: true as const, submissions: view.submissions.map(({ id, headSha }) => ({ id, headSha })) }; }
describe('多仓分支交付真实 SQLite/HTTP', () => {
  it('两人无需领取提交同仓同分支，更新仅本人记录且不推进审查', async () => {
    const { run, repo } = await pending();
    const first = await submit(run.id, repo.id); await submit(run.id, repo.id, userB);
    expect(git.resolveBranchHead).toHaveBeenCalledWith(repo.url, 'feature/web', org);
    git.resolveBranchHead.mockResolvedValueOnce('c'.repeat(40));
    const view = await submit(run.id, repo.id);
    expect(view.submissions).toHaveLength(2); expect(view.stageExecutionId).toBe(first.stageExecutionId);
    expect(view.submissions.find((s) => s.submittedBy?.id === userB)?.headSha).toBe(head);
    expect(view.submissions.find((s) => s.submittedBy?.id === userA)?.headSha).toBe('c'.repeat(40));
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('EXECUTION_RUNNING');
    expect(await prisma.executionSession.count({ where: { workflowRunId: run.id } })).toBe(0);
  });
  it('HTTP 认证、组织、仓库边界与确认显式参数有效', async () => {
    const { run, repo } = await pending(); const other = await pending();
    expect((await fetch(`${baseUrl}/workflow-runs/${run.id}/code-delivery`)).status).toBe(401);
    expect((await post(run.id, 'branches', { workflowRepositoryId: repo.id, branch: 'feature/a' }, userA, 'another-org')).status).toBe(403);
    expect((await post(run.id, 'branches', { workflowRepositoryId: other.repo.id, branch: 'feature/a' })).status).toBe(400);
    expect((await post(run.id, 'branches', { workflowRepositoryId: repo.id, branch: 'feature/a' })).status).toBe(201);
    expect((await post(run.id, 'confirm', { submissions: [], confirmed: false })).status).toBe(400);
    expect((await post(run.id, 'confirm', { submissions: [null], confirmed: true })).status).toBe(400);
  });
  it('每仓只选一个最终版本、真实 diff 冻结并幂等进入既有审查', async () => {
    const { run, repo } = await pending(); await submit(run.id, repo.id); const all = await submit(run.id, repo.id, userB, 'feature/other');
    await expect(service.confirmDelivery(run.id, selection(all), actor())).rejects.toMatchObject({ status: 400 });
    const input = { confirmed: true as const, submissions: selection(all).submissions.slice(0, 1) };
    const confirmed = await service.confirmDelivery(run.id, input, actor());
    expect(git.inspectBranch).toHaveBeenCalledWith(repo.url, 'main', all.submissions[0].branch, head, org);
    expect(confirmed.canSubmit).toBe(false); expect(confirmed.confirmedDelivery).toBeTruthy();
    await service.confirmDelivery(run.id, input, actor(userB));
    expect(await prisma.artifact.count({ where: { workflowRunId: run.id, artifactType: 'GIT_COMMIT' } })).toBe(1);
    const frozen = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id }, include: { codeExecution: true, workflowRepositories: true } });
    expect(frozen.status).toBe('REVIEW_PENDING'); expect(frozen.codeExecution?.diffArtifacts).toMatchObject([{ diffText: expect.stringContaining('diff --git') }]);
    expect(frozen.workflowRepositories[0].localPath).toBeNull();
    await expect(submit(run.id, repo.id)).rejects.toMatchObject({ status: 409 });
    const smoke = new LocalSmokeService(prisma as never, {} as never);
    expect(await (smoke as unknown as { resolveExpectedRevisions(ids: string[]): Promise<unknown> }).resolveExpectedRevisions([run.id])).toEqual([{ workflowRepositoryId: repo.id, branch: all.submissions[0].branch, headSha: head }]);
  });
  it('分支移动、空diff、Git失败均不推进', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id);
    git.inspectBranch.mockRejectedValueOnce(new Error('分支已移动'));
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toThrow('分支已移动');
    git.inspectBranch.mockResolvedValueOnce({ headSha: head, baseSha: base, changedFiles: [], diffStat: '', diffText: '' });
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toMatchObject({ status: 400 });
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('EXECUTION_RUNNING');
    expect(await prisma.codeExecution.count({ where: { workflowRunId: run.id } })).toBe(0);
  });
  it('并发首次提交只有一方成功，且版本严格递增', async () => {
    const { run, repo } = await pending();
    const results = await Promise.allSettled([submit(run.id, repo.id), submit(run.id, repo.id, userB)]);
    expect(results.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((s) => s.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await prisma.stageExecution.count({ where: { workflowRunId: run.id, stage: 'EXECUTION' } })).toBe(1);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).updatedAt.getTime()).toBeGreaterThan(run.updatedAt.getTime());
  });
  it('Git读取期间回退再新尝试不接收旧确认；新轮未完成不取旧冻结版本', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id);
    git.inspectBranch.mockImplementationOnce(async () => {
      await prisma.stageExecution.update({ where: { id: view.stageExecutionId! }, data: { status: 'FAILED' } });
      await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'EXECUTION_PENDING', updatedAt: new Date(Date.now() + 100) } });
      return { headSha: head, baseSha: base, changedFiles: ['src/index.ts'], diffStat: 'changed', diffText: 'diff' };
    });
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toMatchObject({ status: 409 });
    const next = await submit(run.id, repo.id); expect(next.stageExecutionId).not.toBe(view.stageExecutionId); expect(next.submissions).toHaveLength(1);
    expect(next.history).toEqual([{ stageExecutionId: view.stageExecutionId, attempt: 1, status: 'FAILED', submissions: view.submissions }]);
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toMatchObject({ status: 409 });
  });
  it('返工到待开发立即隐藏旧交付，旧确认不具幂等资格', async () => {
    const { run, repo } = await pending();
    const legacy = await prisma.executionSession.create({ data: { workflowRunId: run.id, executorType: 'LOCAL', sourceTool: 'codex', protocolVersion: '1.0', traceId: randomUUID(), status: 'COMPLETED' } });
    await prisma.evidence.create({ data: { executionSessionId: legacy.id, evidenceType: 'GIT_COMMIT', sourceTool: 'codex', title: '旧轮次提交', metadata: { workflowRepositoryId: repo.id, workingBranch: 'obsolete', headSha: 'deadbeef' } } });
    const first = await submit(run.id, repo.id);
    await service.confirmDelivery(run.id, selection(first), actor());
    const reverted = await workflowService.rollbackToPreviousStage(run.id);
    expect(reverted.stageExecutions).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'EXECUTION', status: 'PENDING', attempt: 2, input: expect.objectContaining({ source: 'rollback' }) })]));
    const view = await service.getDelivery(run.id, actor());
    expect(view.stageExecutionId).toBeNull(); expect(view.submissions).toEqual([]); expect(view.confirmedDelivery).toBeNull();
    expect(view.history).toEqual([{ stageExecutionId: first.stageExecutionId, attempt: 1, status: 'COMPLETED', submissions: first.submissions }]);
    await expect(service.confirmDelivery(run.id, selection(first), actor())).rejects.toMatchObject({ status: 409 });
    const smoke = new LocalSmokeService(prisma as never, {} as never);
    expect(await (smoke as unknown as { resolveExpectedRevisions(ids: string[]): Promise<unknown> }).resolveExpectedRevisions([run.id])).toEqual([]);
  });

  it('两个仓库可分别汇集；只确认一个仓库也可进入审查', async () => {
    const { run, repo } = await pending();
    const api = await prisma.workflowRepository.create({ data: { workflowRunId: run.id, name: 'api', url: 'https://example.com/api.git', baseBranch: 'main', workingBranch: 'old-api' } });
    const web = await submit(run.id, repo.id); const all = await submit(run.id, api.id, userB, 'feature/api');
    expect(all.submissions).toHaveLength(2);
    const confirmed = await service.confirmDelivery(run.id, selection(web), actor());
    expect(confirmed.confirmedDelivery?.submissions).toHaveLength(1);
    expect(confirmed.confirmedDelivery?.submissions[0].workflowRepositoryId).toBe(repo.id);
  });

  it('并发确认不重复冻结，明确重试可幂等读取已确认结果', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id); const input = selection(view);
    const results = await Promise.allSettled([service.confirmDelivery(run.id, input, actor()), service.confirmDelivery(run.id, input, actor(userB))]);
    expect(results.some((row) => row.status === 'fulfilled')).toBe(true);
    for (const row of results) if (row.status === 'rejected') expect(row.reason.status).toBe(409);
    expect(await prisma.artifact.count({ where: { workflowRunId: run.id, artifactType: 'GIT_COMMIT' } })).toBe(1);
    expect((await service.confirmDelivery(run.id, input, actor())).confirmedDelivery).toBeTruthy();
  });

  it('确认Git读取期间其他成员更新清单则拒绝旧快照', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id);
    git.inspectBranch.mockImplementationOnce(async () => {
      await submit(run.id, repo.id, userB, 'feature/other');
      return { headSha: head, baseSha: base, changedFiles: ['src/index.ts'], diffStat: 'changed', diffText: 'diff' };
    });
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toMatchObject({ status: 409 });
    expect(await prisma.artifact.count({ where: { workflowRunId: run.id } })).toBe(0);
  });

  it('冻结交付拒绝旧手工改结果及自动推送入口，防止丢失冻结版本', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id);
    await service.confirmDelivery(run.id, selection(view), actor());
    await expect(workflowService.manualEditExecution(run.id, { patchSummary: 'overwrite' })).rejects.toMatchObject({ status: 409 });
    await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'DONE', currentStage: 'HUMAN_REVIEW' } });
    await expect(workflowService.publishGitChanges(run.id)).rejects.toMatchObject({ status: 409 });
    expect((await service.getDelivery(run.id, actor())).confirmedDelivery).toBeTruthy();
  });

  it('分支收集可显式回退到方案，旧确认不能越过回退重新冻结', async () => {
    const { run, repo } = await pending(); const view = await submit(run.id, repo.id);
    const before = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    const reverted = await workflowService.rollbackToPreviousStage(run.id);
    expect(reverted.status).toBe('SPEC_PLAN_PENDING'); expect(reverted.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const deliveryView = await service.getDelivery(run.id, actor());
    expect(deliveryView.submissions).toEqual([]); expect(deliveryView.stageExecutionId).toBeNull();
    expect(deliveryView.history).toEqual([{ stageExecutionId: view.stageExecutionId, attempt: 1, status: 'FAILED', submissions: view.submissions }]);
    expect((await prisma.stageExecution.findUniqueOrThrow({ where: { id: view.stageExecutionId! } })).status).toBe('FAILED');
    expect(await prisma.codeBranchSubmission.count({ where: { workflowRunId: run.id } })).toBe(1);
    await expect(service.confirmDelivery(run.id, selection(view), actor())).rejects.toMatchObject({ status: 409 });
  });

  it.each(['branch', 'cloud'] as const)('首次分支与云执行竞争，%s获胜时只产生一份开发尝试', async (winner) => {
    const { run, repo } = await pending();
    const cloud = new WorkflowService(prisma as never, new WorkflowStateMachine(), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    vi.spyOn(cloud as never, 'resolveAiExecutor' as never).mockReturnValue({} as never);
    vi.spyOn(cloud as never, 'getAiProviderLabel' as never).mockReturnValue('Mock' as never);
    const background = vi.spyOn(cloud as never, 'runInBackground' as never).mockImplementation(() => undefined);
    if (winner === 'branch') {
      vi.spyOn(cloud as never, 'resolveConfirmedSpecPlan' as never).mockImplementation((async () => {
        await submit(run.id, repo.id);
        return { spec: { goal: '共享方案' }, plan: { approach: '开发' } };
      }) as never);
      await expect(cloud.runExecution(run.id)).rejects.toMatchObject({ status: 409 });
      expect(background).not.toHaveBeenCalled();
    } else {
      git.resolveBranchHead.mockImplementationOnce(async () => { await cloud.runExecution(run.id); return head; });
      await expect(submit(run.id, repo.id)).rejects.toMatchObject({ status: 409 });
      expect(background).toHaveBeenCalledTimes(1);
    }
    expect(await prisma.stageExecution.count({ where: { workflowRunId: run.id, stage: 'EXECUTION', status: 'RUNNING' } })).toBe(1);
  });

  it('即使分支阶段标记仍在，也不能回退真实活动会话', async () => {
    const { run, repo } = await pending(); await submit(run.id, repo.id);
    await prisma.executionSession.create({ data: { workflowRunId: run.id, executorType: 'LOCAL', sourceTool: 'codex', protocolVersion: '1.0', traceId: randomUUID(), status: 'RUNNING' } });
    await expect(workflowService.rollbackToPreviousStage(run.id)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('EXECUTION_RUNNING');
  });

  it('历史活动会话即使阶段投影过期也必须先停止再进入分支交付', async () => {
    const { run, repo } = await pending();
    await prisma.executionSession.create({ data: { workflowRunId: run.id, executorType: 'LOCAL', sourceTool: 'codex', protocolVersion: '1.0', traceId: randomUUID(), status: 'RUNNING' } });
    await expect(submit(run.id, repo.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.codeBranchSubmission.count({ where: { workflowRunId: run.id } })).toBe(0);
  });

  it('当前方案未确认、旧LOCAL/CLOUD运行时拒绝分支交付', async () => {
    const { run, repo } = await pending();
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', attempt: 2, status: 'WAITING_CONFIRMATION' } });
    await expect(submit(run.id, repo.id)).rejects.toMatchObject({ status: 409 });
    const other = await pending();
    await prisma.stageExecution.create({ data: { workflowRunId: other.run.id, stage: 'EXECUTION', status: 'RUNNING', input: { executor: 'LOCAL' } } });
    await prisma.workflowRun.update({ where: { id: other.run.id }, data: { status: 'EXECUTION_RUNNING' } });
    await expect(submit(other.run.id, other.repo.id)).rejects.toMatchObject({ status: 409 });
  });
});
