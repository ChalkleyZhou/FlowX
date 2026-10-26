import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequirementsService } from './requirements.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-requirement-delete-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const deletedWorkflowIds: string[] = [];
const workflowService = {
  async deleteWorkflowRun(id: string) {
    deletedWorkflowIds.push(id);
    const running = await prisma.stageExecution.count({ where: { workflowRunId: id, status: 'RUNNING' } });
    if (running > 0) {
      const error = new Error('当前工作流仍有阶段在执行中，请等待完成后再删除。') as Error & { status: number };
      error.status = 400;
      throw error;
    }
    await prisma.$transaction(async (tx) => {
      await tx.issue.updateMany({ where: { workflowRunId: id }, data: { workflowRunId: null } });
      await tx.bug.updateMany({ where: { workflowRunId: id }, data: { workflowRunId: null } });
      await tx.stageExecution.deleteMany({ where: { workflowRunId: id } });
      await tx.workflowRun.delete({ where: { id } });
    });
    return { success: true };
  },
};
const service = new RequirementsService(
  prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, workflowService,
);
let workspaceId: string;
let projectId: string;
let versionId: string;
let repositoryId: string;
let userId: string;

beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'requirement-delete-test', name: '删除测试组织' } });
  const workspace = await prisma.workspace.create({ data: { name: '删除契约', organizationId: organization.id } });
  workspaceId = workspace.id;
  const project = await prisma.project.create({ data: { name: '删除项目', workspaceId } });
  projectId = project.id;
  versionId = (await prisma.projectVersion.create({ data: { name: '1.0', projectId } })).id;
  repositoryId = (await prisma.repository.create({ data: { workspaceId, name: 'flowx', url: 'https://example.com/flowx.git' } })).id;
  userId = (await prisma.user.create({ data: { displayName: '产品甲' } })).id;
}, 30_000);

beforeEach(() => {
  deletedWorkflowIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function createRequirement(title: string) {
  return prisma.requirement.create({
    data: {
      projectId,
      workspaceId,
      versionId,
      title,
      description: '待删除',
      acceptanceCriteria: '可删除',
    },
  });
}

describe('删除需求', () => {
  it('不存在的需求返回 404', async () => {
    await expect(service.remove('missing-requirement')).rejects.toMatchObject({ status: 404 });
  });

  it('删除需求及其工作流、排期和仓库范围，并保留已解除关联的问题与缺陷', async () => {
    const requirement = await createRequirement('可删除需求');
    const kept = await createRequirement('保留需求');
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'DONE' } });
    await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'COMPLETED' } });
    await prisma.requirementRepository.create({ data: { requirementId: requirement.id, repositoryId } });
    await prisma.requirementAssignment.create({
      data: {
        requirementId: requirement.id,
        userId,
        role: '开发',
        plannedStartDate: new Date('2026-10-01'),
        plannedEndDate: new Date('2026-10-02'),
      },
    });
    await prisma.ideationArtifact.create({ data: { requirementId: requirement.id, type: 'BRAINSTORM_BRIEF', content: { summary: '草案' } } });
    await prisma.requirementChange.create({
      data: { requirementId: requirement.id, revision: 1, content: '补充说明', mode: 'APPEND', requestId: 'req-delete-1', createdByUserId: userId, createdByName: '产品甲' },
    });
    const issue = await prisma.issue.create({
      data: { title: '遗留问题', description: '保留', workspaceId, requirementId: requirement.id, workflowRunId: workflow.id },
    });
    const bug = await prisma.bug.create({
      data: {
        title: '跨需求缺陷',
        description: '保留来源',
        workspaceId,
        requirementId: kept.id,
        fixRequirementId: requirement.id,
        fixWorkflowRunId: workflow.id,
      },
    });

    await expect(service.remove(requirement.id)).resolves.toEqual({ success: true });

    expect(deletedWorkflowIds).toEqual([workflow.id]);
    expect(await prisma.requirement.findUnique({ where: { id: requirement.id } })).toBeNull();
    expect(await prisma.workflowRun.findUnique({ where: { id: workflow.id } })).toBeNull();
    expect(await prisma.requirementAssignment.count({ where: { requirementId: requirement.id } })).toBe(0);
    expect(await prisma.requirementRepository.count({ where: { requirementId: requirement.id } })).toBe(0);
    expect(await prisma.ideationArtifact.count({ where: { requirementId: requirement.id } })).toBe(0);
    expect(await prisma.requirementChange.count({ where: { requirementId: requirement.id } })).toBe(0);
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toMatchObject({ requirementId: null, workflowRunId: null });
    expect(await prisma.bug.findUnique({ where: { id: bug.id } })).toMatchObject({
      requirementId: kept.id,
      fixRequirementId: null,
      fixWorkflowRunId: null,
    });
    expect(await prisma.requirement.findUnique({ where: { id: kept.id } })).toMatchObject({ title: '保留需求' });
  });

  it('工作流仍在执行时拒绝删除，且不改动需求', async () => {
    const requirement = await createRequirement('执行中需求');
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'EXECUTION_RUNNING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'RUNNING' } });

    await expect(service.remove(requirement.id)).rejects.toMatchObject({ status: 400 });

    expect(deletedWorkflowIds).toEqual([]);
    expect(await prisma.requirement.findUnique({ where: { id: requirement.id } })).toMatchObject({ title: '执行中需求' });
    expect(await prisma.workflowRun.findUnique({ where: { id: workflow.id } })).toBeTruthy();
  });

  it('已关联测试设计或提测时拒绝删除', async () => {
    const designed = await createRequirement('已进测试设计');
    await prisma.testDesign.create({
      data: {
        workspaceId,
        projectId,
        projectVersionId: versionId,
        sourceFingerprint: 'design-fingerprint',
        sourceSummary: { source: 'test' },
        requirements: { create: { requirementId: designed.id } },
      },
    });
    await expect(service.remove(designed.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.requirement.findUnique({ where: { id: designed.id } })).toBeTruthy();

    const requested = await createRequirement('已提测');
    await prisma.testRequest.create({
      data: {
        workspaceId,
        projectId,
        projectVersionId: versionId,
        title: '提测单',
        traceId: 'trace-requirement-delete',
        requirementLinks: { create: { requirementId: requested.id } },
      },
    });
    await expect(service.remove(requested.id)).rejects.toMatchObject({ status: 409 });
    expect(deletedWorkflowIds).toEqual([]);
    expect(await prisma.requirement.findUnique({ where: { id: requested.id } })).toBeTruthy();
  });

  it('工作流已纳入测试设计时拒绝删除', async () => {
    const requirement = await createRequirement('工作流已进测试设计');
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'DONE' } });
    const design = await prisma.testDesign.create({
      data: {
        workspaceId,
        projectId,
        projectVersionId: versionId,
        sourceFingerprint: 'workflow-design-fingerprint',
        sourceSummary: { source: 'workflow' },
        revision: 2,
      },
    });
    await prisma.testDesignWorkflowRun.create({ data: { testDesignId: design.id, workflowRunId: workflow.id } });

    await expect(service.remove(requirement.id)).rejects.toMatchObject({ status: 409 });

    expect(deletedWorkflowIds).toEqual([]);
    expect(await prisma.workflowRun.findUnique({ where: { id: workflow.id } })).toBeTruthy();
  });
});
