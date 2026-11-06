import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirementsService } from './requirements.service';
import { TestDesignsService } from '../quality/test-designs.service';
import { WorkflowService } from '../workflow/workflow.service';
import { RequirementAssignmentsService } from './requirement-assignments.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-requirement-read-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new RequirementsService(
  prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
);
const importedRequirements: Array<{ id: string; prototypeImport: { id: string; status: string } }> = [];
let ordinaryRequirementId: string;

beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'requirement-read-test', name: '读取测试组织' } });
  const workspace = await prisma.workspace.create({ data: { name: '读取契约测试', organizationId: organization.id } });
  const project = await prisma.project.create({ data: { name: '原型导入列表', workspaceId: workspace.id } });
  const requirementData = { projectId: project.id, workspaceId: workspace.id, title: '事项看板', description: '管理事项', acceptanceCriteria: '支持新增事项' };
  for (const status of ['ANALYZING', 'WAITING_CONFIRMATION', 'FAILED', 'CONFIRMED']) {
    const requirement = await prisma.requirement.create({ data: {
      ...requirementData,
      prototypeImport: { create: { status, manifest: { files: [] }, analysis: { privateDraft: '不应返回列表' }, answers: { internalAnswer: '不应返回列表' } } },
    }, include: { prototypeImport: { select: { id: true, status: true } } } });
    importedRequirements.push({ id: requirement.id, prototypeImport: requirement.prototypeImport! });
  }
  ordinaryRequirementId = (await prisma.requirement.create({ data: requirementData })).id;
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe('RequirementsService 原型导入读取契约', () => {
  it('列表返回全部导入状态摘要，普通需求为 null，且不泄露分析和答案', async () => {
    const rows = await service.findAll();
    expect(rows).toHaveLength(5);
    for (const requirement of importedRequirements) {
      expect(rows.find((row) => row.id === requirement.id)).toHaveProperty('prototypeImport', requirement.prototypeImport);
    }
    expect(rows.find((row) => row.id === ordinaryRequirementId)).toHaveProperty('prototypeImport', null);
  });

  it('列表给出最近一次需求变更时间和正文，不返回更早变更或变更集合', async () => {
    await prisma.requirementChange.create({ data: { requirementId: ordinaryRequirementId, revision: 1, content: '较早变更', mode: 'SUPPLEMENT', requestId: 'older', createdByUserId: 'author', createdByName: '产品', createdAt: new Date('2026-10-20T00:00:00.000Z') } });
    await prisma.requirementChange.create({ data: { requirementId: ordinaryRequirementId, revision: 2, content: '最新变更正文', mode: 'SUPPLEMENT', requestId: 'newer', createdByUserId: 'author', createdByName: '产品', createdAt: new Date('2026-10-26T09:30:00.000Z') } });
    const rows = await service.findAll();
    const ordinary = rows.find((row) => row.id === ordinaryRequirementId);
    expect(ordinary).toMatchObject({ latestChangeAt: new Date('2026-10-26T09:30:00.000Z'), latestChangeContent: '最新变更正文' });
    expect(ordinary).not.toHaveProperty('changes');
    expect(JSON.stringify(ordinary)).not.toContain('较早变更');
    expect(rows.find((row) => row.id === importedRequirements[0].id)).toMatchObject({ latestChangeAt: null, latestChangeContent: null });
  });

  it('详情与列表使用相同的最小导入摘要契约', async () => {
    for (const requirement of importedRequirements) {
      const detail = await service.findOne(requirement.id);
      expect(detail).toMatchObject(requirement);
      expect(detail.prototypeImport).toEqual(requirement.prototypeImport);
    }
    expect(await service.findOne(ordinaryRequirementId)).toHaveProperty('prototypeImport', null);
  });
  it('真实数据库按筛选分页且相同时间的记录不会跨页重复，统计覆盖全部记录', async () => {
    const ordinary = await prisma.requirement.findUniqueOrThrow({where:{id:ordinaryRequirementId}});
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    await prisma.requirement.createMany({data:Array.from({length:25},(_,index)=>({
      id:`paged-requirement-${String(index).padStart(2,'0')}`, projectId:ordinary.projectId, workspaceId:ordinary.workspaceId,
      title:`分页匹配 ${index}`,description:'分页说明',acceptanceCriteria:'',priority:'LOW',planningStatus:'DONE',createdAt,
    }))});
    const filters = {projectId:ordinary.projectId,planningStatus:'DONE',priority:'LOW',q:'分页匹配'};
    const first = await service.findPage({...filters,page:'1'});
    const second = await service.findPage({...filters,page:'2'});
    expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(5);
    expect(first).toMatchObject({total:25,page:1,pageSize:20,totalPages:2,summary:{requirementCount:30,visibleCount:25,workspaceCount:1,projectCount:1}});
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(25);
    expect(first.items[0].id).toBe('paged-requirement-24');
    expect(first.items[0].project.workspace).not.toHaveProperty('repositories');
    expect(first.items[0]).not.toHaveProperty('assignments');
  });

  it('真实数据库分页排除被取代流程，total与项目版本筛选一致', async () => {
    const ordinary = await prisma.requirement.findUniqueOrThrow({where:{id:ordinaryRequirementId}});
    const version = await prisma.projectVersion.create({data:{projectId:ordinary.projectId,name:'分页版本'}});
    await prisma.requirement.update({where:{id:ordinary.id},data:{versionId:version.id}});
    await prisma.workflowRun.createMany({data:Array.from({length:25},(_,index)=>({id:`paged-workflow-${index}`,requirementId:ordinary.id,status:'DONE',createdAt:new Date('2026-11-02T00:00:00Z')}))});
    const change = await prisma.requirementChange.findFirstOrThrow({where:{requirementId:ordinary.id}});
    await prisma.workflowRun.update({where:{id:'paged-workflow-0'},data:{supersededByChangeId:change.id}});
    const workflows = Object.assign(Object.create(WorkflowService.prototype),{prisma}) as WorkflowService;
    const filters={projectId:ordinary.projectId,versionId:version.id,status:'DONE',excludeSuperseded:'true'};
    const first=await workflows.findPage({...filters,page:'1'});const second=await workflows.findPage({...filters,page:'2'});
    expect(first).toMatchObject({total:24,totalPages:2});expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(4);
    expect([...first.items,...second.items].some(item=>item.id==='paged-workflow-0')).toBe(false);
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(24);
  });

  it('排期分页合计在SQL覆盖所有记录，并与工作日计算一致', async () => {
    const user=await prisma.user.create({data:{displayName:'排期成员'}});
    await prisma.requirementAssignment.createMany({data:Array.from({length:25},()=>({requirementId:ordinaryRequirementId,userId:user.id,role:'DEVELOPER',plannedStartDate:new Date(2026,10,2),plannedEndDate:new Date(2026,10,6)}))});
    const assignments=new RequirementAssignmentsService(prisma as never);
    const first=await assignments.listPage(ordinaryRequirementId,{page:'1'});
    const second=await assignments.listPage(ordinaryRequirementId,{page:'2'});
    expect(first).toMatchObject({total:25,summary:{estimatedDays:125}});
    expect(second).toMatchObject({total:25,summary:{estimatedDays:125}});
    expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(5);
    expect(first.items[0].estimatedDays).toBe(5);
  });

  it('质量准备只返回当前需求的测试设计，不能取同版本其他需求的最新设计', async () => {
    const ordinary = await prisma.requirement.findUniqueOrThrow({ where: { id: ordinaryRequirementId } });
    const other = await prisma.requirement.create({ data: { projectId: ordinary.projectId, workspaceId: ordinary.workspaceId, versionId: ordinary.versionId, title: '事项其他需求', description: '', acceptanceCriteria: '' } });
    const current = await prisma.testDesign.create({ data: { projectId: ordinary.projectId, workspaceId: ordinary.workspaceId, projectVersionId: ordinary.versionId!, revision: 1, sourceFingerprint: 'current', sourceSummary: {}, updatedAt: new Date('2026-11-01'), requirements: { create: { requirementId: ordinary.id } } } });
    await prisma.testDesign.create({ data: { projectId: ordinary.projectId, workspaceId: ordinary.workspaceId, projectVersionId: ordinary.versionId!, revision: 2, sourceFingerprint: 'other', sourceSummary: {}, updatedAt: new Date('2026-11-02'), requirements: { create: { requirementId: other.id } } } });
    const designs = new TestDesignsService(prisma as never, {} as never, {} as never);
    for (const q of [undefined, '事项']) {
      const page = await designs.listDesigns({ projectId: ordinary.projectId, projectVersionId: ordinary.versionId!, requirementId: ordinary.id, q, pageSize: 1 });
      expect(page).toMatchObject({ total: 1, summary: { NOT_STARTED: 1 } });
      expect(page.items.map(row => row.id)).toEqual([current.id]);
    }
  });

  it('工作流分页提供最新Spec & Plan就绪投影，其他阶段反复重试不挤掉该阶段', async () => {
    const run = await prisma.workflowRun.create({ data: { requirementId: ordinaryRequirementId, status: 'EXECUTION_PENDING' } });
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'COMPLETED', attempt: 1, output: { spec: { goal: '确认完成' } } } });
    await prisma.stageExecution.createMany({ data: Array.from({ length: 25 }, (_, index) => ({ workflowRunId: run.id, stage: 'DESIGN', status: 'FAILED', attempt: index + 1 })) });
    const workflows = Object.assign(Object.create(WorkflowService.prototype), { prisma }) as WorkflowService;
    const first = await workflows.findPage({ requirementId: ordinaryRequirementId, status: 'EXECUTION_PENDING' });
    const ready = first.items.find(row => row.id === run.id)!;
    expect(ready.status).not.toBe('DONE');
    expect(ready.stageExecutions).toEqual([expect.objectContaining({ stage: 'SPEC_PLAN', status: 'COMPLETED', attempt: 1 })]);
    await prisma.stageExecution.create({ data: { workflowRunId: run.id, stage: 'SPEC_PLAN', status: 'RUNNING', attempt: 2 } });
    const next = await workflows.findPage({ requirementId: ordinaryRequirementId, status: 'EXECUTION_PENDING' });
    expect(next.items.find(row => row.id === run.id)!.stageExecutions).toEqual([expect.objectContaining({ stage: 'SPEC_PLAN', status: 'RUNNING', attempt: 2 })]);
  });

});
