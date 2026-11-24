import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-project-delete-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new ProjectsService(prisma as never);
let organizationId: string;
let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'project-delete-org', name: '项目删除组织' } });
  organizationId = organization.id;
  const workspace = await prisma.workspace.create({ data: { organizationId, name: '项目删除工作区' } });
  workspaceId = workspace.id;
  const project = await prisma.project.create({ data: { workspaceId, name: '待删除项目' } });
  projectId = project.id;
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function createFixture() {
  const version = await prisma.projectVersion.create({ data: { projectId, name: `v-${Date.now()}-${Math.random()}` } });
  await prisma.project.update({ where: { id: projectId }, data: { currentVersionId: version.id } });
  const item = await prisma.workItem.create({ data: { projectId, workspaceId, versionId: version.id, title: '项目需求' } });
  const workflow = await prisma.workflowRun.create({ data: { workItemId: item.id, status: 'DONE' } });
  await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'COMPLETED' } });
  const label = await prisma.projectLabel.create({ data: { projectId, name: `标签-${Date.now()}`, nameKey: `tag-${Date.now()}` } });
  await prisma.workItemLabel.create({ data: { workItemId: item.id, labelId: label.id } });
  return { version, item, workflow, label };
}

async function createProjectFixture() {
  const project = await prisma.project.create({ data: { workspaceId, name: `活动项目-${Date.now()}-${Math.random()}` } });
  const version = await prisma.projectVersion.create({ data: { projectId: project.id, name: 'v1' } });
  await prisma.project.update({ where: { id: project.id }, data: { currentVersionId: version.id } });
  const item = await prisma.workItem.create({ data: { projectId: project.id, workspaceId, versionId: version.id, title: '活动需求' } });
  return { project, item };
}

describe('删除项目', () => {
  it('主管理员可以删除项目及其版本、工作项、工作流和标签', async () => {
    const fixture = await createFixture();
    const controller = new ProjectsController(service, {} as never);

    await expect(controller.remove(projectId, { authSession: { organization: { role: 'admin' } } })).resolves.toEqual({ success: true, projectId });

    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    expect(await prisma.projectVersion.findUnique({ where: { id: fixture.version.id } })).toBeNull();
    expect(await prisma.workItem.findUnique({ where: { id: fixture.item.id } })).toBeNull();
    expect(await prisma.workflowRun.findUnique({ where: { id: fixture.workflow.id } })).toBeNull();
    expect(await prisma.projectLabel.findUnique({ where: { id: fixture.label.id } })).toBeNull();
  });

  it.each(['member', 'sub_admin'] as const)('拒绝 %s 删除项目', async (role) => {
    const controller = new ProjectsController(service, {} as never);
    expect(() => controller.remove(projectId, { authSession: { organization: { role } } })).toThrow('只有主组织管理员可以删除项目。');
  });

  it('存在运行中的工作流阶段时拒绝删除且保留项目', async () => {
    const fixture = await createProjectFixture();
    const workflow = await prisma.workflowRun.create({ data: { workItemId: fixture.item.id, status: 'EXECUTION_RUNNING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'RUNNING' } });
    await expect(service.remove(fixture.project.id)).rejects.toThrow('项目存在执行中的工作流或本地任务');
    expect(await prisma.project.findUnique({ where: { id: fixture.project.id } })).toBeTruthy();
  });

  it('存在活动本地会话时拒绝删除且保留项目', async () => {
    const fixture = await createProjectFixture();
    const workflow = await prisma.workflowRun.create({ data: { workItemId: fixture.item.id, status: 'EXECUTION_PENDING' } });
    await prisma.executionSession.create({ data: { workflowRunId: workflow.id, projectId: fixture.project.id, executorType: 'LOCAL', sourceTool: 'codex', protocolVersion: '1.0', traceId: randomUUID(), status: 'RUNNING' } });
    await expect(service.remove(fixture.project.id)).rejects.toThrow('项目存在执行中的工作流或本地任务');
    expect(await prisma.project.findUnique({ where: { id: fixture.project.id } })).toBeTruthy();
  });

  it('删除项目时清理测试设计和提测的版本引用', async () => {
    const fixture = await createProjectFixture();
    const artifact = await prisma.artifact.create({ data: { workspaceId, projectId: fixture.project.id, artifactType: 'TEST', name: '测试上下文' } });
    const design = await prisma.testDesign.create({ data: { workspaceId, projectId: fixture.project.id, projectVersionId: (await prisma.project.findUniqueOrThrow({ where: { id: fixture.project.id }, select: { currentVersionId: true } })).currentVersionId!, sourceFingerprint: 'delete-design', sourceSummary: {} } });
    const request = await prisma.testRequest.create({ data: { workspaceId, projectId: fixture.project.id, projectVersionId: (await prisma.project.findUniqueOrThrow({ where: { id: fixture.project.id }, select: { currentVersionId: true } })).currentVersionId!, title: '删除提测', traceId: `delete-request-${Date.now()}`, artifactLinks: { create: { artifactId: artifact.id } } } });
    await expect(service.remove(fixture.project.id)).resolves.toEqual({ success: true, projectId: fixture.project.id });
    expect(await prisma.testDesign.findUnique({ where: { id: design.id } })).toBeNull();
    expect(await prisma.testRequest.findUnique({ where: { id: request.id } })).toBeNull();
  });
});
