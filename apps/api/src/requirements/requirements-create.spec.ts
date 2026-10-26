import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { validate } from 'class-validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { RequirementsService } from './requirements.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-requirement-create-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new RequirementsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
let projectId: string;
let versionId: string;
let otherVersionId: string;
let unversionedProjectId: string;

beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'requirement-create-test', name: '创建测试组织' } });
  const workspace = await prisma.workspace.create({ data: { name: '最小创建', organizationId: organization.id } });
  const project = await prisma.project.create({ data: { name: '当前项目', workspaceId: workspace.id } });
  projectId = project.id;
  const version = await prisma.projectVersion.create({ data: { name: '1.0', projectId } });
  versionId = version.id;
  await prisma.project.update({ where: { id: projectId }, data: { currentVersionId: versionId } });
  const other = await prisma.project.create({ data: { name: '其他项目', workspaceId: workspace.id } });
  unversionedProjectId = other.id;
  otherVersionId = (await prisma.projectVersion.create({ data: { name: '2.0', projectId: other.id } })).id;
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe('需求最小创建契约', () => {
  it('DTO 接受只有项目、标题和版本的请求，仍拒绝非字符串补充内容', async () => {
    expect(await validate(Object.assign(new CreateRequirementDto(), { projectId, title: '最小需求', versionId }))).toEqual([]);
    expect(await validate(Object.assign(new CreateRequirementDto(), { projectId, title: '最小需求', versionId, description: 123 }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'description' })]));
    expect(await validate(Object.assign(new CreateRequirementDto(), { projectId, title: '最小需求', versionId, functionalModule: 123 }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'functionalModule' })]));
    expect(await validate(Object.assign(new CreateRequirementDto(), { projectId, title: '最小需求', versionId, priority: 'URGENT' }))).toEqual([]);
    expect(await validate(Object.assign(new CreateRequirementDto(), { projectId, title: '最小需求', versionId, priority: 'P0' }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'priority' })]));
  });

  it('创建时记下当前用户，并带回创建时间', async () => {
    const row = await service.create({ projectId, title: '带创建人', versionId } as CreateRequirementDto, { user: { id: 'user-1', displayName: '产品甲' } });
    expect(row).toMatchObject({ createdByUserId: 'user-1', createdByName: '产品甲' });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('只有标题和版本也能落库，缺省描述与验收标准保存为空串', async () => {
    const row = await service.create({ projectId, title: '  快捷新建  ', versionId } as CreateRequirementDto);
    expect(row).toMatchObject({ projectId, title: '快捷新建', versionId, priority: 'MEDIUM', description: '', acceptanceCriteria: '', functionalModule: '', riskImpact: '', productRequirementDocument: '', remark: '' });
  });

  it('功能模块、风险与影响、产品需求文档和备注去空白后落库', async () => {
    const row = await service.create({
      projectId,
      title: '补充档案',
      versionId,
      functionalModule: '  登录  ',
      riskImpact: '  影响已登录会话  ',
      productRequirementDocument: '  https://example.com/prd  ',
      remark: '  内部备忘  ',
    } as CreateRequirementDto);
    expect(row).toMatchObject({
      functionalModule: '登录',
      riskImpact: '影响已登录会话',
      productRequirementDocument: 'https://example.com/prd',
      remark: '内部备忘',
    });
    const urgent = await service.create({ projectId, title: '紧急需求', versionId, priority: 'URGENT' } as CreateRequirementDto);
    expect(urgent.priority).toBe('URGENT');
  });

  it('未指定版本时兼容默认当前版本，并保留可选补充信息', async () => {
    const row = await service.create({ projectId, title: '正常需求', description: '  补充描述  ', acceptanceCriteria: '  可观察结果  ' });
    expect(row).toMatchObject({ versionId, description: '补充描述', acceptanceCriteria: '可观察结果' });
  });

  it('拒绝空白标题、明确不挂版本及无当前版本的请求，不产生数据', async () => {
    const count = await prisma.requirement.count();
    for (const input of [
      { projectId, title: '  ', versionId },
      { projectId, title: '不可无版本', versionId: null },
      { projectId: unversionedProjectId, title: '缺少版本' },
    ]) {
      await expect(service.create(input as CreateRequirementDto)).rejects.toMatchObject({ status: 400 });
    }
    expect(await prisma.requirement.count()).toBe(count);
  });

  it('拒绝跨项目版本，不产生需求', async () => {
    await expect(service.create({ projectId, title: '跨项目', versionId: otherVersionId } as CreateRequirementDto)).rejects.toThrow();
    expect(await prisma.requirement.count({ where: { title: '跨项目' } })).toBe(0);
  });

  it('可以修改需求名称、描述、优先级、版本和补充档案', async () => {
    expect(await validate(Object.assign(new UpdateRequirementDto(), {
      title: '新标题',
      priority: 'URGENT',
      functionalModule: '登录',
    }))).toEqual([]);
    expect(await validate(Object.assign(new UpdateRequirementDto(), { functionalModule: 123 }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'functionalModule' })]),
    );
    const created = await service.create({
      projectId,
      title: '待修改',
      versionId,
      description: '旧描述',
      functionalModule: '旧模块',
      remark: '旧备注',
    } as CreateRequirementDto);
    const updated = await service.update(created.id, {
      title: '  新标题  ',
      description: '  新描述  ',
      acceptanceCriteria: '  可验收  ',
      priority: 'URGENT',
      functionalModule: '  登录  ',
      riskImpact: '  影响会话  ',
      productRequirementDocument: '  https://example.com/prd  ',
      remark: '  备注  ',
      versionId,
    });
    expect(updated).toMatchObject({
      title: '新标题',
      description: '新描述',
      acceptanceCriteria: '可验收',
      priority: 'URGENT',
      functionalModule: '登录',
      riskImpact: '影响会话',
      productRequirementDocument: 'https://example.com/prd',
      remark: '备注',
      versionId,
    });
    const scheduled = await service.update(created.id, { planningStatus: 'SCHEDULED' });
    expect(scheduled).toMatchObject({
      title: '新标题',
      functionalModule: '登录',
      remark: '备注',
      planningStatus: 'SCHEDULED',
    });
    await expect(service.update(created.id, { title: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(service.update(created.id, { versionId: otherVersionId })).rejects.toMatchObject({ status: 400 });
    const kept = await service.findOne(created.id);
    expect(kept.title).toBe('新标题');
    expect(kept.versionId).toBe(versionId);
  });
});
