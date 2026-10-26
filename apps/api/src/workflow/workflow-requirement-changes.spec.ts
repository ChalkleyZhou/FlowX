import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { RequirementChangesService } from '../requirements/requirement-changes.service';
import { PrototypeArchive } from '../prototype-imports/prototype-archive';
import { analysis } from '../prototype-imports/prototype-test-fixture';
import { ContextPackageService } from '../edge/context-package.service';
const directory = mkdtempSync(join(tmpdir(), 'flowx-workflow-changes-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sync = { syncWorkspaceRepositories: vi.fn(), prepareWorkflowRepositories: vi.fn(), generateWorkflowRepositoryGrounding: vi.fn(), buildWorkflowRepositoryPath: () => '/tmp/changes-test' };
const stopAfterContext = () => vi.fn(async (_input: unknown) => { throw new Error('上下文测试主动中断'); });
const generateDesign = stopAfterContext(), generateSpecPlan = stopAfterContext(), executeTask = stopAfterContext(), reviewCode = stopAfterContext();
const brainstorm = vi.fn(async (_input: unknown) => ({ problemStatement: '导出', targetUsers: [], goals: [], nonGoals: [], userStories: [], constraints: [], openQuestions: [] }));
const workflow = new WorkflowService(prisma as never, new WorkflowStateMachine(), sync as never, {} as never,
  { normalizeAiProvider: (value?: string) => value ?? 'codex', resolveOnlineProvider: async (_organizationId?: string | null, value?: string | null) => value === 'cursor' ? 'cursor' : 'codex', resolveInvocationContext: async () => ({}) } as never,
  { get: () => ({ brainstorm, generateDesign, generateSpecPlan, executeTask, reviewCode }) } as never, {} as never, {} as never);
const jobs = new Map<string, () => Promise<void>>();
vi.spyOn(workflow as never, 'runInBackground' as never).mockImplementation(((key: string, job: () => Promise<void>) => jobs.set(key, job)) as never);
const changes = new RequirementChangesService(prisma as never, workflow);
const author = { user: { id: 'author', displayName: '提交人' }, organization: { id: 'org' } };
let projectId: string, workspaceId: string;
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js'); const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
  await prisma.user.create({ data: { id: 'author', displayName: '提交人' } });
  await prisma.organization.create({ data: { id: 'org', provider: 'test', providerOrganizationId: 'workflow-changes', name: '变更组织' } });
  workspaceId = (await prisma.workspace.create({ data: { name: '工作流变更', organizationId: 'org' } })).id;
  projectId = (await prisma.project.create({ data: { name: '工作流项目', workspaceId } })).id;
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
async function fixture() { return prisma.requirement.create({ data: { title: '导出', description: '原始要求', acceptanceCriteria: '', projectId, workspaceId, ideationStatus: 'FINALIZED' } }); }

describe('需求变更工作流与上下文', () => {
  it('新流程从构思开始，旧轮及原型历史不变且重复重试不新建流程', async () => {
    const req = await fixture();
    const old = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'DONE', runType: 'LOCAL_DESIGN' } });
    await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'DESIGN', status: 'COMPLETED', output: { legacy: '保留' } } });
    await prisma.prototypeImport.create({ data: { requirementId: req.id, status: 'CONFIRMED', manifest: {}, analysis: {} } });
    const change = await changes.create(req.id, { content: '导出增加 Excel', mode: 'RESTART', requestId: 'restart', sourceWorkflowRunId: old.id }, author);
    expect(change.restartStatus).toBe('STARTED');
    const id = change.restartWorkflowRunId!;
    await jobs.get(`grounding:${id}`)?.();
    const current = await workflow.findOne(id);
    expect(current).toMatchObject({ status: 'BRAINSTORM_PENDING', sourceChangeId: change.id });
    expect(current.stageExecutions.some((stage) => stage.stage === 'REQUIREMENT_INTAKE')).toBe(false);
    expect((await workflow.findOne(old.id)).stageExecutions[0].output).toEqual({ legacy: '保留' });
    await changes.restart(req.id, change.id);
    expect(await prisma.workflowRun.count({ where: { sourceChangeId: change.id } })).toBe(1);
    await workflow.runBrainstorm(id);
    expect((await changes.list(req.id, id)).contextRevision).toBe(1);
    await jobs.get(`brainstorm:${id}`)?.();
    expect(brainstorm.mock.calls[0][0]).toMatchObject({ requirementDescription: expect.stringContaining('导出增加 Excel') });
    expect((await changes.list(req.id, id)).contextRevision).toBe(0);
  });
  it('待确认旧轮可被明确替代，保留交付历史且不能再回退或领取', async () => {
    const req = await fixture();
    const old = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'SPEC_PLAN_WAITING_CONFIRMATION', currentStage: 'SPEC_PLAN' } });
    await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'SPEC_PLAN', status: 'WAITING_CONFIRMATION', output: { oldSpec: '历史方案' } } });
    const surfaces = [{ id: 'web', pages: [{ id: 'index', relPath: `${old.id}/web/index.html`, bytes: 12, generatedAt: new Date().toISOString() }] }];
    await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'DESIGN', status: 'COMPLETED', output: { surfaces } } });
    const change = await changes.create(req.id, { content: '重新明确导出规则', mode: 'RESTART', requestId: 'supersede', sourceWorkflowRunId: old.id }, author);
    expect(change.restartStatus).toBe('STARTED');
    const previous = await workflow.findOne(old.id);
    expect(previous).toMatchObject({ status: 'FAILED', supersededByChangeId: change.id });
    expect(previous.stageExecutions.find(stage => stage.stage === 'SPEC_PLAN')?.output).toEqual({ oldSpec: '历史方案' });
    await expect(workflow.rollbackToPreviousStage(old.id)).rejects.toMatchObject({ status: 409 });
    await expect(workflow.claimLocalSpecPlan(old.id, author)).rejects.toMatchObject({ status: 409 });
    await expect(workflow.runSpecPlan(old.id)).rejects.toMatchObject({ status: 409 });
    expect(await workflow.getHistory(old.id)).toHaveLength(2);
    expect(await workflow.listWorkflowDesignArtifacts(old.id)).toEqual({ surfaces });
    const reader = vi.spyOn(workflow as unknown as { readWorkflowDesignArtifactHtml(path: string): Promise<string | null> }, 'readWorkflowDesignArtifactHtml').mockResolvedValueOnce('<main>旧原型</main>');
    try {
      expect(await workflow.getWorkflowDesignArtifactPage(old.id, 'web', 'index')).toMatchObject({ exists: true, html: '<main>旧原型</main>' });
    } finally { reader.mockRestore(); }
  });
  it('两个不同变更并发重启时，准备中的 CREATED 不能被替代或复活', async () => {
    const req = await fixture();
    let prepared!: () => void; let entered!: () => void;
    const preparation = new Promise<void>((resolve) => { prepared = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    sync.prepareWorkflowRepositories.mockImplementationOnce(async () => { entered(); await preparation; });
    const first = changes.create(req.id, { content: '第一轮', mode: 'RESTART', requestId: 'parallel-one' }, author);
    await started;
    const preparing = await prisma.workflowRun.findFirstOrThrow({ where: { requirementId: req.id } });
    expect(preparing.status).toBe('CREATED');
    const second = await changes.create(req.id, { content: '第二轮', mode: 'RESTART', requestId: 'parallel-two' }, author);
    expect(second).toMatchObject({ restartStatus: 'PENDING', restartWorkflowRunId: null });
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: preparing.id } })).supersededByChangeId).toBeNull();
    prepared();
    expect(await first).toMatchObject({ restartStatus: 'STARTED', restartWorkflowRunId: preparing.id });
    expect(await prisma.workflowRun.count({ where: { requirementId: req.id } })).toBe(1);
  });
  it('跨需求的同仓库活跃任务阻挡重启，结束后可重试，准备失败复用同一轮恢复', async () => {
    const req = await fixture(); const other = await fixture();
    const repo = await prisma.repository.create({ data: { name: 'shared', url: 'https://example.test/repo.git', workspaceId } });
    await prisma.requirementRepository.create({ data: { requirementId: req.id, repositoryId: repo.id } });
    const old = await prisma.workflowRun.create({ data: { requirementId: other.id, status: 'EXECUTION_RUNNING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'EXECUTION', status: 'RUNNING' } });
    await prisma.workflowRepository.create({ data: { workflowRunId: old.id, repositoryId: repo.id, name: 'shared', url: repo.url, baseBranch: 'main', workingBranch: 'old' } });
    const change = await changes.create(req.id, { content: '重做', mode: 'RESTART', requestId: 'conflict' }, author);
    expect(change).toMatchObject({ restartStatus: 'PENDING', restartWorkflowRunId: null });
    await prisma.workflowRun.update({ where: { id: old.id }, data: { status: 'DONE' } });
    sync.prepareWorkflowRepositories.mockRejectedValueOnce(new Error('credential=SECRET'));
    const failed = await changes.restart(req.id, change.id);
    expect(failed.restartStatus).toBe('FAILED');
    expect(failed.restartWorkflowRunId).toBeTruthy();
    expect(failed.errorMessage).not.toContain('SECRET');
    const resumed = await changes.restart(req.id, change.id);
    expect(resumed).toMatchObject({ restartStatus: 'STARTED', restartWorkflowRunId: failed.restartWorkflowRunId });
    expect(await prisma.workflowRun.count({ where: { sourceChangeId: change.id } })).toBe(1);
    await prisma.workflowRun.update({ where: { id: resumed.restartWorkflowRunId! }, data: { status: 'DONE' } });
  });
  it('其他需求同仓库待执行不阻塞重启，且原待执行轮不被作废', async () => {
    const req = await fixture(); const other = await fixture();
    const repo = await prisma.repository.create({ data: { name: 'idle-shared', url: 'https://example.test/idle.git', workspaceId } });
    await prisma.requirementRepository.create({ data: { requirementId: req.id, repositoryId: repo.id } });
    const old = await prisma.workflowRun.create({ data: { requirementId: other.id, status: 'SPEC_PLAN_PENDING', currentStage: 'SPEC_PLAN' } });
    await prisma.workflowRepository.create({ data: { workflowRunId: old.id, repositoryId: repo.id, name: repo.name, url: repo.url, baseBranch: 'main', workingBranch: 'idle' } });
    const pendingStage = await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'SPEC_PLAN', status: 'PENDING' } });
    const change = await changes.create(req.id, { content: '其他需求仍可排队', mode: 'RESTART', requestId: 'idle-other' }, author);
    expect(change.restartStatus).toBe('STARTED');
    expect(await workflow.findOne(old.id)).toMatchObject({ status: 'SPEC_PLAN_PENDING', supersededByChangeId: null });
    expect(await prisma.stageExecution.findUniqueOrThrow({ where: { id: pendingStage.id } })).toMatchObject({ status: 'PENDING' });
    await prisma.workflowRun.updateMany({ where: { id: { in: [old.id, change.restartWorkflowRunId!] } }, data: { status: 'DONE' } });
  });
  it('首建轮准备期间其他需求同仓库被领取时保持待启动，且不作废原轮', async () => {
    const req = await fixture(); const other = await fixture();
    const repo = await prisma.repository.create({ data: { name: 'prepare-shared', url: 'https://example.test/prepare.git', workspaceId } });
    await prisma.requirementRepository.create({ data: { requirementId: req.id, repositoryId: repo.id } });
    const old = await prisma.workflowRun.create({ data: { requirementId: other.id, status: 'BRAINSTORM_PENDING', currentStage: 'BRAINSTORM' } });
    await prisma.workflowRepository.create({ data: { workflowRunId: old.id, repositoryId: repo.id, name: repo.name, url: repo.url, baseBranch: 'main', workingBranch: 'idle' } });
    await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'BRAINSTORM', status: 'PENDING' } });
    let entered!: () => void; let resume!: () => void;
    const enteredPreparation = new Promise<void>((resolve) => { entered = resolve; });
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    sync.prepareWorkflowRepositories.mockImplementationOnce(async () => { entered(); await resumed; });
    const starting = changes.create(req.id, { content: '准备期间复查', mode: 'RESTART', requestId: 'first-prepare' }, author);
    // 旧实现会在进入准备前直接拒绝其他需求，因此先让该断言明确失败。
    const reached = await Promise.race([enteredPreparation.then(() => true), starting.then(() => false)]);
    if (!reached) { sync.prepareWorkflowRepositories.mockReset(); resume(); }
    expect(reached).toBe(true);
    const local = await workflow.claimLocalBrainstorm(old.id, author);
    resume();
    const change = await starting;
    expect(change).toMatchObject({ restartStatus: 'PENDING', restartWorkflowRunId: expect.any(String) });
    expect(await workflow.findOne(change.restartWorkflowRunId!)).toMatchObject({ status: 'FAILED' });
    expect(await workflow.findOne(old.id)).toMatchObject({ status: 'BRAINSTORM_PENDING', supersededByChangeId: null });
    expect(jobs.has(`grounding:${change.restartWorkflowRunId}`)).toBe(false);
    await prisma.executionSession.update({ where: { id: local.handoff.executionSessionId }, data: { status: 'CANCELLED' } });
    await prisma.stageExecution.updateMany({ where: { workflowRunId: old.id, status: 'RUNNING' }, data: { status: 'FAILED' } });
    await prisma.workflowRun.updateMany({ where: { id: { in: [old.id, change.restartWorkflowRunId!] } }, data: { status: 'DONE' } });
  });
  it('本地构思领取冻结正式增量与读取修订，重复读取不冒充接收新变更', async () => {
    const req = await fixture();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'BRAINSTORM_PENDING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'BRAINSTORM', status: 'PENDING' } });
    await changes.create(req.id, { content: '第一次补充', mode: 'SUPPLEMENT', requestId: 'local-one' }, author);
    const claimed = await workflow.claimLocalBrainstorm(run.id, author);
    expect(claimed.handoff.contextPackage.requirement.description).toContain('第一次补充');
    expect(await changes.list(req.id, run.id)).toMatchObject({ contextRevision: 1, hasPendingChanges: false });
    await changes.create(req.id, { content: '第二次补充', mode: 'SUPPLEMENT', requestId: 'local-two' }, author);
    const again = await workflow.claimLocalBrainstorm(run.id, author);
    expect(again.handoff.contextPackage.requirement.description).not.toContain('第二次补充');
    expect(await changes.list(req.id, run.id)).toMatchObject({ contextRevision: 1, hasPendingChanges: true });
    const context = await new ContextPackageService(prisma as never).getContextPackage('requirement', req.id, 'codex');
    expect(context.task.description).toContain('第二次补充');
  });
  it('异步 grounding 失败后变更恢复重试入口，复用同一轮继续构思', async () => {
    const req = await fixture();
    const change = await changes.create(req.id, { content: '恢复异步启动', mode: 'RESTART', requestId: 'grounding-failure' }, author);
    expect(change.restartStatus).toBe('STARTED');
    sync.generateWorkflowRepositoryGrounding.mockRejectedValueOnce(new Error('secret=NO_OUTPUT'));
    await jobs.get(`grounding:${change.restartWorkflowRunId}`)?.();
    const failed = (await changes.list(req.id)).changes[0];
    expect(failed).toMatchObject({ restartStatus: 'FAILED', restartWorkflowRunId: change.restartWorkflowRunId });
    expect(failed.errorMessage).not.toContain('NO_OUTPUT');
    const resumed = await changes.restart(req.id, change.id);
    expect(resumed).toMatchObject({ restartStatus: 'STARTED', restartWorkflowRunId: change.restartWorkflowRunId });
    await jobs.get(`grounding:${change.restartWorkflowRunId}`)?.();
    expect(await workflow.findOne(change.restartWorkflowRunId!)).toMatchObject({ status: 'BRAINSTORM_PENDING' });
    expect(await prisma.workflowRun.count({ where: { sourceChangeId: change.id } })).toBe(1);
    await prisma.workflowRun.update({ where: { id: resumed.restartWorkflowRunId! }, data: { status: 'DONE' } });
  });

  it('恢复已有失败轮时事务内替代其他闲置轮，不能留下两个活动轮', async () => {
    const req = await fixture();
    sync.prepareWorkflowRepositories.mockRejectedValueOnce(new Error('准备失败'));
    const first = await changes.create(req.id, { content: '第一版', mode: 'RESTART', requestId: 'resume-one' }, author);
    expect(first.restartStatus).toBe('FAILED');
    const second = await changes.create(req.id, { content: '第二版', mode: 'RESTART', requestId: 'resume-two' }, author);
    expect(second.restartStatus).toBe('STARTED');
    await jobs.get(`grounding:${second.restartWorkflowRunId}`)?.();
    const resumed = await changes.restart(req.id, first.id);
    expect(resumed).toMatchObject({ restartStatus: 'STARTED', restartWorkflowRunId: first.restartWorkflowRunId });
    expect(await workflow.findOne(second.restartWorkflowRunId!)).toMatchObject({ status: 'FAILED', supersededByChangeId: first.id });
    expect(await prisma.workflowRun.count({ where: { requirementId: req.id, status: { notIn: ['DONE', 'FAILED'] } } })).toBe(1);
    await prisma.workflowRun.update({ where: { id: resumed.restartWorkflowRunId! }, data: { status: 'DONE' } });
  });

  it('恢复轮准备期间其他轮被实际领取时保持待启动，不越过活跃任务', async () => {
    const req = await fixture();
    sync.prepareWorkflowRepositories.mockRejectedValueOnce(new Error('首次准备失败'));
    const first = await changes.create(req.id, { content: '第一轮', mode: 'RESTART', requestId: 'preparing-one' }, author);
    const second = await changes.create(req.id, { content: '第二轮', mode: 'RESTART', requestId: 'preparing-two' }, author);
    await jobs.get(`grounding:${second.restartWorkflowRunId}`)?.();
    let prepared!: () => void; let entered!: () => void;
    const preparation = new Promise<void>((resolve) => { prepared = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    sync.prepareWorkflowRepositories.mockImplementationOnce(async () => { entered(); await preparation; });
    const retry = changes.restart(req.id, first.id);
    await started;
    const local = await workflow.claimLocalBrainstorm(second.restartWorkflowRunId!, author);
    prepared();
    expect(await retry).toMatchObject({ restartStatus: 'PENDING', restartWorkflowRunId: first.restartWorkflowRunId });
    expect(await workflow.findOne(second.restartWorkflowRunId!)).toMatchObject({ supersededByChangeId: null, status: 'BRAINSTORM_PENDING' });
    expect(await workflow.findOne(first.restartWorkflowRunId!)).toMatchObject({ status: 'FAILED' });
    await prisma.executionSession.update({ where: { id: local.handoff.executionSessionId }, data: { status: 'CANCELLED' } });
    await prisma.stageExecution.updateMany({ where: { workflowRunId: second.restartWorkflowRunId!, status: 'RUNNING' }, data: { status: 'FAILED' } });
    await prisma.workflowRun.updateMany({ where: { requirementId: req.id }, data: { status: 'DONE' } });
  });

  it.each([
    ['BRAINSTORM', 'BRAINSTORM_PENDING', 'runBrainstorm'],
    ['DESIGN', 'DESIGN_PENDING', 'runDesign'],
    ['SPEC_PLAN', 'SPEC_PLAN_PENDING', 'runSpecPlan'],
    ['AI_REVIEW', 'REVIEW_PENDING', 'runReview'],
  ] as const)('云端 %s 只读检查后旧轮被替代，事务拒绝旧请求启动', async (stage, status, method) => {
    const req = await fixture();
    const repo = await prisma.repository.create({ data: { name: `race-${stage}`, url: 'https://example.test/race.git', workspaceId } });
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status, currentStage: stage } });
    await prisma.workflowRepository.create({ data: { workflowRunId: run.id, repositoryId: repo.id, name: repo.name, url: repo.url, baseBranch: 'main', workingBranch: 'old' } });
    if (stage === 'AI_REVIEW') {
      await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '导出' }, plan: { approach: '实现' } } } });
      await prisma.codeExecution.create({ data: { workflowRunId: run.id, patchSummary: '导出', changedFiles: [], codeChanges: [] } });
    }
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage, status: 'FAILED' } });
    let entered!: () => void; let resume!: () => void;
    const enteredTx = new Promise<void>((resolve) => { entered = resolve; });
    const resumeTx = new Promise<void>((resolve) => { resume = resolve; });
    const delayedDb = { workflowRun: prisma.workflowRun, $transaction: async (callback: Parameters<typeof prisma.$transaction>[0]) => { entered(); await resumeTx; return prisma.$transaction(callback as never); } };
    const delayed = new WorkflowService(delayedDb as never, new WorkflowStateMachine(), sync as never, {} as never,
      { normalizeAiProvider: (value?: string) => value ?? 'codex', resolveOnlineProvider: async (_organizationId?: string | null, value?: string | null) => value === 'cursor' ? 'cursor' : 'codex' } as never, { get: () => ({ brainstorm, generateDesign, generateSpecPlan, executeTask, reviewCode }) } as never, {} as never, {} as never);
    const background = vi.spyOn(delayed as never, 'runInBackground' as never).mockImplementation((() => undefined) as never);
    const pending = delayed[method](run.id);
    await enteredTx;
    const change = await changes.create(req.id, { content: '取代旧轮', mode: 'RESTART', requestId: `race-${stage}`, sourceWorkflowRunId: run.id }, author);
    expect(change.restartStatus).toBe('STARTED');
    resume();
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(background).not.toHaveBeenCalled();
    expect(await prisma.stageExecution.count({ where: { workflowRunId: run.id, status: 'RUNNING' } })).toBe(0);
  });

  it.each([
    ['DESIGN', 'DESIGN_PENDING', 'runDesign', 'design', generateDesign],
    ['SPEC_PLAN', 'SPEC_PLAN_PENDING', 'runSpecPlan', 'spec-plan', generateSpecPlan],
    ['EXECUTION', 'EXECUTION_PENDING', 'runExecution', 'execution', executeTask],
    ['AI_REVIEW', 'REVIEW_PENDING', 'runReview', 'review', reviewCode],
  ] as const)('云端 %s 读取所有正式变更并记录本次修订', async (stage, status, method, jobKey, executor) => {
    executor.mockClear();
    const req = await fixture();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status, currentStage: stage } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '导出', scope: [], nonGoals: [], acceptanceCriteria: [], constraints: [] }, plan: { approach: '实现', touchpoints: [], sequence: [], risks: [], verification: [] } } } });
    if (stage === 'DESIGN') await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage, status: 'PENDING' } });
    if (stage === 'AI_REVIEW') await prisma.codeExecution.create({ data: { workflowRunId: run.id, patchSummary: '实现导出', changedFiles: [], codeChanges: [] } });
    for (const [index, content] of ['云端增加 Excel', '云端保留筛选'].entries()) await changes.create(req.id, { content, mode: 'SUPPLEMENT', requestId: `cloud-${index}` }, author);
    await workflow[method](run.id);
    const current = await prisma.stageExecution.findFirstOrThrow({ where: { workflowRunId: run.id, stage, status: 'RUNNING' }, orderBy: { attempt: 'desc' } });
    expect(current.input).toMatchObject({ requirementRevision: 2 });
    await changes.create(req.id, { content: '生成期间的新补充', mode: 'SUPPLEMENT', requestId: 'during-generation' }, author);
    await jobs.get(`${jobKey}:${run.id}`)?.();
    expect(executor).toHaveBeenCalledOnce();
    const input = executor.mock.calls[0][0] as { requirement?: { description: string }; requirementDescription?: string };
    const description = input.requirement?.description ?? input.requirementDescription;
    expect(description).toContain('云端增加 Excel');
    expect(description).toContain('云端保留筛选');
    expect(description).not.toContain('生成期间的新补充');
    if (stage === 'DESIGN') expect((input as unknown as { confirmedBrief: { expandedDescription: string } }).confirmedBrief.expandedDescription).not.toContain('生成期间的新补充');
  });

  it.each(['DESIGN', 'SPEC_PLAN', 'EXECUTION'] as const)('本地 %s 领取后保留快照，再领取才读到新修订', async (stage) => {
    const req = await fixture();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status: `${stage}_PENDING`, currentStage: stage } });
    if (stage === 'EXECUTION') await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '导出', scope: [], nonGoals: [], acceptanceCriteria: [], constraints: [] }, plan: { approach: '实现', touchpoints: [], sequence: [], risks: [], verification: [] } } } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage, status: 'PENDING' } });
    await changes.create(req.id, { content: '本地第一次补充', mode: 'SUPPLEMENT', requestId: 'snapshot-one' }, author);
    const claim = stage === 'DESIGN' ? await workflow.claimLocalDesign(run.id, author) : stage === 'SPEC_PLAN' ? await workflow.claimLocalSpecPlan(run.id, author) : await workflow.claimLocalExecution(run.id, author);
    const handoff = claim.handoff;
    const initialDescription = 'contextPackage' in handoff ? handoff.contextPackage.requirement.description : handoff.requirement.description;
    expect(initialDescription).toContain('本地第一次补充');
    expect(await changes.list(req.id, run.id)).toMatchObject({ contextRevision: 1, hasPendingChanges: false });
    await changes.create(req.id, { content: '本地第二次补充', mode: 'SUPPLEMENT', requestId: 'snapshot-two' }, author);
    const repeated = stage === 'DESIGN' ? (await workflow.claimLocalDesign(run.id, author)).handoff : stage === 'SPEC_PLAN' ? (await workflow.claimLocalSpecPlan(run.id, author)).handoff : await workflow.getLocalHandoff(run.id);
    const repeatedDescription = 'contextPackage' in repeated ? repeated.contextPackage.requirement.description : repeated.requirement.description;
    expect(repeatedDescription).not.toContain('本地第二次补充');
    if (stage === 'SPEC_PLAN') expect(JSON.stringify(repeated)).not.toContain('本地第二次补充');
    expect(await changes.list(req.id, run.id)).toMatchObject({ contextRevision: 1, hasPendingChanges: true });
  });

  it.each(['BRAINSTORM', 'DESIGN', 'SPEC_PLAN', 'EXECUTION'] as const)('历史本地 %s 无快照时只读取记录修订内的增量', async (stage) => {
    const req = await fixture();
    const run = await prisma.workflowRun.create({ data: { requirementId: req.id, status: `${stage}_PENDING`, currentStage: stage } });
    if (stage === 'EXECUTION') await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '导出', scope: [], nonGoals: [], acceptanceCriteria: [], constraints: [] }, plan: { approach: '实现', touchpoints: [], sequence: [], risks: [], verification: [] } } } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage, status: 'PENDING' } });
    const revision = stage === 'DESIGN' ? 1 : 0;
    if (revision) await changes.create(req.id, { content: '领取时已知补充', mode: 'SUPPLEMENT', requestId: 'known-legacy-change' }, author);
    if (stage === 'BRAINSTORM') await workflow.claimLocalBrainstorm(run.id, author);
    else if (stage === 'DESIGN') await workflow.claimLocalDesign(run.id, author);
    else if (stage === 'SPEC_PLAN') await workflow.claimLocalSpecPlan(run.id, author);
    else await workflow.claimLocalExecution(run.id, author);
    // 模拟上线前已领取、缺少正式增量快照与读取修订的本地会话。
    await prisma.stageExecution.updateMany({ where: { workflowRunId: run.id, stage, status: 'RUNNING' }, data: { input: { source: 'LOCAL_LEGACY', executor: 'LOCAL', ...(revision ? { requirementRevision: revision } : {}) } } });
    await changes.create(req.id, { content: '上线后的新变更', mode: 'SUPPLEMENT', requestId: 'legacy-change' }, author);
    const handoff = stage === 'BRAINSTORM' ? (await workflow.claimLocalBrainstorm(run.id, author)).handoff : stage === 'DESIGN' ? (await workflow.claimLocalDesign(run.id, author)).handoff : stage === 'SPEC_PLAN' ? (await workflow.claimLocalSpecPlan(run.id, author)).handoff : await workflow.getLocalHandoff(run.id);
    const description = 'contextPackage' in handoff ? handoff.contextPackage.requirement.description : handoff.requirement.description;
    expect(description).toContain('原始要求');
    expect(description).not.toContain('上线后的新变更');
    if (revision) expect(description).toContain('领取时已知补充');
    expect(await changes.list(req.id, run.id)).toMatchObject({ contextRevision: revision, hasPendingChanges: true });
  });

  it('原型变更新轮读取独立快照和所选 AI，原需求与旧轮产物保持原样', async () => {
    const req = await fixture();
    const repository = await prisma.repository.create({ data: { workspaceId, name: '原型变更仓库', url: 'https://example.com/change-prototype.git', defaultBranch: 'main' } });
    const old = await prisma.workflowRun.create({ data: { requirementId: req.id, status: 'DONE', aiProvider: 'codex' } });
    await prisma.workflowRepository.create({ data: { workflowRunId: old.id, repositoryId: repository.id, name: repository.name, url: repository.url, baseBranch: 'main', workingBranch: 'old', status: 'READY' } });
    const oldStage = await prisma.stageExecution.create({ data: { workflowRunId: old.id, stage: 'DESIGN', status: 'COMPLETED', output: { legacy: '旧原型产物' } } });
    const snapshot = { source: 'prototype-import', importId: 'new-change-archive', materialRevision: 1, revision: 1, confirmedAt: new Date().toISOString(), confirmedBy: null, analysis };
    const surfaces = vi.spyOn(PrototypeArchive.prototype, 'surfaces').mockResolvedValue([]);
    try {
      const change = await changes.create(req.id, { content: '使用新 ZIP', mode: 'RESTART', requestId: 'prototype-snapshot', sourceWorkflowRunId: old.id }, author,
        { archiveId: 'new-change-archive', name: 'new.zip', sha256: 'hash', aiProvider: 'cursor', manifest: { files: [], pages: [], kinds: [], sources: [], warnings: [] }, snapshot } as never);
      await vi.waitFor(async () => expect((await changes.list(req.id)).changes[0].restartStatus).toBe('STARTED'));
      const next = (await changes.list(req.id)).changes[0];
      await jobs.get(`grounding:${next.restartWorkflowRunId}`)?.();
      const run = await workflow.findOne(next.restartWorkflowRunId!);
      expect(run).toMatchObject({ aiProvider: 'cursor', status: 'SPEC_PLAN_PENDING' });
      expect(run.stageExecutions.find(stage => stage.stage === 'REQUIREMENT_INTAKE')?.output).toMatchObject(snapshot);
      expect(surfaces).toHaveBeenCalledWith('new-change-archive', 1);
      expect(await prisma.stageExecution.findUniqueOrThrow({ where: { id: oldStage.id } })).toEqual(oldStage);
      expect(await prisma.requirement.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ title: req.title, description: req.description });
    } finally { surfaces.mockRestore(); }
  });

});
