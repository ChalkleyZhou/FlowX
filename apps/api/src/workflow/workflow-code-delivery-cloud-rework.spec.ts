import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { RepositorySyncService } from '../workspaces/repository-sync.service';
const directory = mkdtempSync(join(tmpdir(), 'flowx-cloud-rework-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const source = join(directory, 'source');
const remote = join(directory, 'remote.git');
const previousRoot = process.env.WORKSPACE_REPOS_ROOT;
process.env.WORKSPACE_REPOS_ROOT = join(directory, 'workflows');
const sync = new RepositorySyncService(prisma as never, { getAccessTokenForProvider: vi.fn() } as never);
let projectId: string, workspaceId: string;
function git(args: string[], cwd = directory) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
  const org = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'rework', name: '返工组织' } });
  workspaceId = (await prisma.workspace.create({ data: { name: '返工空间', organizationId: org.id } })).id;
  projectId = (await prisma.project.create({ data: { name: '返工项目', workspaceId } })).id;
  git(['init', '--initial-branch=main', source]); git(['config', 'user.email', 'test@example.com'], source); git(['config', 'user.name', 'Test'], source);
  writeFileSync(join(source, 'base.txt'), 'base'); git(['add', '.'], source); git(['commit', '-m', 'base'], source);
  git(['checkout', '-b', 'feature/delivery'], source); writeFileSync(join(source, 'delivered.txt'), 'delivered implementation'); git(['add', '.'], source); git(['commit', '-m', 'delivery'], source);
  git(['clone', '--bare', source, remote]);
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); if (previousRoot === undefined) delete process.env.WORKSPACE_REPOS_ROOT; else process.env.WORKSPACE_REPOS_ROOT = previousRoot; });
async function frozen(branch = 'feature/delivery') {
  const requirement = await prisma.requirement.create({ data: { title: '修复已交付代码', description: '', acceptanceCriteria: '', workspaceId, projectId } });
  const run = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'HUMAN_REVIEW_PENDING', currentStage: 'HUMAN_REVIEW' } });
  const selected = await prisma.workflowRepository.create({ data: { workflowRunId: run.id, name: 'web', url: remote, baseBranch: 'main', workingBranch: branch, localPath: null } });
  const excluded = await prisma.workflowRepository.create({ data: { workflowRunId: run.id, name: 'api', url: remote, baseBranch: 'main', workingBranch: 'old-api', localPath: '/unselected/old-checkout' } });
  await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', output: { spec: { goal: '修复' }, plan: { approach: '修改已交付代码' } } } });
  const snapshot = { executor: 'CODE_DELIVERY', delivery: { submissions: [{ id: 'submission', workflowRepositoryId: selected.id, repository: 'web', branch, headSha: git(['rev-parse', 'feature/delivery'], source), baseSha: git(['rev-parse', 'main'], source), submittedByUserId: 'user' }] } };
  const stage = await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'EXECUTION', status: 'COMPLETED', attempt: 1, input: { executor: 'CODE_DELIVERY' }, output: snapshot } });
  return { run, selected, excluded, stage, snapshot };
}
function cloud() {
  const executeTask = vi.fn(async (input: { workspace: { repositories: Array<{ localPath: string }> } }) => ({ patchSummary: '修复完成', changedFiles: [join(input.workspace.repositories[0].localPath, 'delivered.txt')], codeChanges: [], diffArtifacts: [] }));
  const reviewCode = vi.fn(async (_input: { workspace: { repositories: Array<{ localPath: string }> } }) => ({ issues: [], bugs: [], missingTests: [], suggestions: [], impactScope: [] }));
  const service = new WorkflowService(prisma as never, new WorkflowStateMachine(), sync, {} as never,
    { normalizeAiProvider: () => 'codex', resolveInvocationContext: async () => ({}) } as never,
    { get: () => ({ executeTask, reviewCode }) } as never, {} as never, {} as never);
  let job: (() => Promise<void>) | undefined;
  const background = vi.spyOn(service as never, 'runInBackground' as never).mockImplementation(((_key: string, task: () => Promise<void>) => { job = task; }) as never);
  return { service, executeTask, reviewCode, background, runJob: () => job?.() };
}
describe('冻结分支进入云端返工', () => {
  it('真实回退到开发后继承冻结范围，云端准备新checkout且不改旧交付', async () => {
    const fixture = await frozen(); const { service, executeTask, runJob } = cloud();
    await prisma.workflowRun.update({ where: { id: fixture.run.id }, data: { status: 'REVIEW_PENDING', currentStage: 'AI_REVIEW' } });
    const rolledBack = await service.rollbackToPreviousStage(fixture.run.id);
    const pending = rolledBack.stageExecutions.filter((stage) => stage.stage === 'EXECUTION').sort((a, b) => b.attempt - a.attempt)[0];
    expect(pending.input).toMatchObject({ source: 'rollback', sourceDeliveryStageExecutionId: fixture.stage.id });
    await service.runExecution(fixture.run.id); await runJob();
    expect(executeTask).toHaveBeenCalledOnce();
    const repositories = executeTask.mock.calls[0][0].workspace.repositories;
    expect(repositories).toHaveLength(1);
    expect(readFileSync(join(repositories[0].localPath, 'delivered.txt'), 'utf8')).toBe('delivered implementation');
    expect((await prisma.workflowRepository.findUniqueOrThrow({ where: { id: fixture.excluded.id } })).localPath).toBe('/unselected/old-checkout');
    expect((await prisma.stageExecution.findUniqueOrThrow({ where: { id: fixture.stage.id } })).output).toEqual(fixture.snapshot);
  });

  it('云端返工后的发布只提交选中仓库，未选READY仓库保留未提交改动', async () => {
    const fixture = await frozen(); const { service, executeTask, runJob } = cloud();
    await service.runExecution(fixture.run.id, '修复'); await runJob();
    const selectedPath = executeTask.mock.calls[0][0].workspace.repositories[0].localPath;
    const excludedPath = join(directory, `excluded-${fixture.run.id}`);
    git(['clone', remote, excludedPath]);
    git(['checkout', '-b', 'old-api'], excludedPath);
    for (const path of [selectedPath, excludedPath]) {
      git(['config', 'user.email', 'test@example.com'], path); git(['config', 'user.name', 'Test'], path);
      writeFileSync(join(path, 'unpublished.txt'), path === selectedPath ? 'selected fix' : 'excluded local edit');
    }
    const excludedHead = git(['rev-parse', 'HEAD'], excludedPath);
    await prisma.workflowRepository.update({ where: { id: fixture.excluded.id }, data: { localPath: excludedPath, status: 'READY' } });
    await prisma.workflowRun.update({ where: { id: fixture.run.id }, data: { status: 'DONE', currentStage: 'HUMAN_REVIEW' } });
    vi.spyOn(service as never, 'resolvePublishRemoteUrl' as never).mockResolvedValue(remote as never);
    const published = await service.publishGitChanges(fixture.run.id);
    expect(published.repositories.map((repository) => repository.repository)).toEqual(['web']);
    expect(git(['rev-parse', 'HEAD'], excludedPath)).toBe(excludedHead);
    expect(git(['status', '--porcelain'], excludedPath)).toContain('unpublished.txt');
    expect(git(['show', `${published.repositories[0].commitSha}:unpublished.txt`], selectedPath)).toBe('selected fix');
  });

  it('有明确交付范围但所选仓库不可发布时，不回退到旧diffArtifact仓库', async () => {
    const fixture = await frozen(); const { service, runJob } = cloud();
    await service.runExecution(fixture.run.id, '修复'); await runJob();
    await prisma.workflowRepository.update({ where: { id: fixture.selected.id }, data: { status: 'ERROR', localPath: null } });
    await prisma.codeExecution.update({ where: { workflowRunId: fixture.run.id }, data: { diffArtifacts: [{ repository: 'api', localPath: '/unselected/legacy', branch: 'old-api' }] } });
    await prisma.workflowRun.update({ where: { id: fixture.run.id }, data: { status: 'DONE' } });
    const runGit = vi.spyOn(service as never, 'runGit' as never);
    await expect(service.publishGitChanges(fixture.run.id)).rejects.toThrow('当前工作流没有可提交的代码仓库');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('CAS成功后后台仅为选中仓库准备新checkout，包含已交付代码且重读真实路径', async () => {
    const fixture = await frozen(); const { service, executeTask, runJob } = cloud();
    await service.runExecution(fixture.run.id, '修复审查问题');
    expect((await prisma.workflowRepository.findUniqueOrThrow({ where: { id: fixture.selected.id } })).localPath).toBeNull();
    await runJob();
    expect(executeTask).toHaveBeenCalledOnce();
    const repositories = executeTask.mock.calls[0][0].workspace.repositories;
    expect(repositories).toHaveLength(1); expect(repositories[0].localPath).toBeTruthy();
    expect(readFileSync(join(repositories[0].localPath, 'delivered.txt'), 'utf8')).toBe('delivered implementation');
    expect(git(['branch', '--show-current'], repositories[0].localPath)).toBe('feature/delivery');
    expect((await prisma.workflowRepository.findUniqueOrThrow({ where: { id: fixture.excluded.id } })).localPath).toBe('/unselected/old-checkout');
    expect((await prisma.stageExecution.findUniqueOrThrow({ where: { id: fixture.stage.id } })).output).toEqual(fixture.snapshot);
    const execution = await prisma.codeExecution.findUniqueOrThrow({ where: { workflowRunId: fixture.run.id } });
    expect(execution.changedFiles).not.toEqual(expect.arrayContaining([expect.stringContaining(directory)]));
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).status).toBe('REVIEW_PENDING');
  });
  it('分支不可读取时明确失败，不启动executor且保留旧冻结记录', async () => {
    const fixture = await frozen('deleted/branch'); const { service, executeTask, runJob } = cloud();
    await service.runExecution(fixture.run.id, '修复'); await runJob();
    expect(executeTask).not.toHaveBeenCalled();
    const stages = await prisma.stageExecution.findMany({ where: { workflowRunId: fixture.run.id, stage: 'EXECUTION' }, orderBy: { attempt: 'desc' } });
    expect(stages[0].status).toBe('FAILED'); expect(stages[0].errorMessage).toBeTruthy(); expect(stages[1].output).toEqual(fixture.snapshot);
  });
  it('云端后续反馈沿用选中仓库和本地修复，不混入未选旧checkout或重置为remote', async () => {
    const fixture = await frozen(); const first = cloud();
    await first.service.runExecution(fixture.run.id, '第一轮修复'); await first.runJob();
    const localPath = first.executeTask.mock.calls[0][0].workspace.repositories[0].localPath;
    writeFileSync(join(localPath, 'cloud-only.txt'), 'unpublished cloud changes');
    const next = cloud(); await next.service.runExecution(fixture.run.id, '第二轮反馈'); await next.runJob();
    expect(next.executeTask).toHaveBeenCalledOnce();
    const repositories = next.executeTask.mock.calls[0][0].workspace.repositories;
    expect(repositories).toHaveLength(1); expect(repositories[0].localPath).toBe(localPath);
    expect(readFileSync(join(repositories[0].localPath, 'cloud-only.txt'), 'utf8')).toBe('unpublished cloud changes');
    await next.service.runReview(fixture.run.id); await next.runJob();
    expect(next.reviewCode.mock.calls[0][0].workspace.repositories).toHaveLength(1);
    expect(next.reviewCode.mock.calls[0][0].workspace.repositories[0].localPath).toBe(localPath);
  });

  it('分支准备失败后恢复远程分支，可在新attempt重试且旧冻结不变', async () => {
    const fixture = await frozen('restored/branch'); const first = cloud();
    await first.service.runExecution(fixture.run.id, '修复'); await first.runJob();
    expect(first.executeTask).not.toHaveBeenCalled();
    git(['push', remote, 'feature/delivery:refs/heads/restored/branch'], source);
    const next = cloud(); await next.service.runExecution(fixture.run.id); await next.runJob();
    expect(next.executeTask).toHaveBeenCalledOnce();
    expect(readFileSync(join(next.executeTask.mock.calls[0][0].workspace.repositories[0].localPath, 'delivered.txt'), 'utf8')).toBe('delivered implementation');
    expect((await prisma.stageExecution.findUniqueOrThrow({ where: { id: fixture.stage.id } })).output).toEqual(fixture.snapshot);
  });

  it('云端执行后再回退开发，继承仓库范围并保留未推送的本地修复', async () => {
    const fixture = await frozen(); const first = cloud();
    await first.service.runExecution(fixture.run.id, '第一轮修复'); await first.runJob();
    const localPath = first.executeTask.mock.calls[0][0].workspace.repositories[0].localPath;
    writeFileSync(join(localPath, 'cloud-only.txt'), 'unpublished cloud changes');
    const next = cloud();
    await next.service.rollbackToPreviousStage(fixture.run.id);
    await next.service.runExecution(fixture.run.id); await next.runJob();
    const repositories = next.executeTask.mock.calls[0][0].workspace.repositories;
    expect(repositories).toHaveLength(1); expect(repositories[0].localPath).toBe(localPath);
    expect(readFileSync(join(localPath, 'cloud-only.txt'), 'utf8')).toBe('unpublished cloud changes');
  });

  it('CAS失败不准备仓库、不启动后台或executor', async () => {
    const fixture = await frozen(); const { service, executeTask, background } = cloud();
    vi.spyOn(service as never, 'resolveConfirmedSpecPlan' as never).mockImplementation((async () => {
      await prisma.workflowRun.update({ where: { id: fixture.run.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
      return { spec: { goal: '修复' }, plan: { approach: '修改' } };
    }) as never);
    await expect(service.runExecution(fixture.run.id, '修复')).rejects.toMatchObject({ status: 409 });
    expect(background).not.toHaveBeenCalled(); expect(executeTask).not.toHaveBeenCalled();
    expect((await prisma.workflowRepository.findUniqueOrThrow({ where: { id: fixture.selected.id } })).localPath).toBeNull();
  });
});
