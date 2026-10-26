import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirementsService } from './requirements.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-requirement-read-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const service = new RequirementsService(
  prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
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

  it('列表给出最近一次需求变更时间，不返回变更正文', async () => {
    await prisma.requirementChange.create({ data: { requirementId: ordinaryRequirementId, revision: 1, content: '较早变更', mode: 'SUPPLEMENT', requestId: 'older', createdByUserId: 'author', createdByName: '产品', createdAt: new Date('2026-10-20T00:00:00.000Z') } });
    await prisma.requirementChange.create({ data: { requirementId: ordinaryRequirementId, revision: 2, content: '最新变更正文', mode: 'SUPPLEMENT', requestId: 'newer', createdByUserId: 'author', createdByName: '产品', createdAt: new Date('2026-10-26T09:30:00.000Z') } });
    const rows = await service.findAll();
    const ordinary = rows.find((row) => row.id === ordinaryRequirementId);
    expect(ordinary).toMatchObject({ latestChangeAt: new Date('2026-10-26T09:30:00.000Z') });
    expect(ordinary).not.toHaveProperty('changes');
    expect(JSON.stringify(ordinary)).not.toContain('最新变更正文');
    expect(rows.find((row) => row.id === importedRequirements[0].id)).toMatchObject({ latestChangeAt: null });
  });

  it('详情与列表使用相同的最小导入摘要契约', async () => {
    for (const requirement of importedRequirements) {
      const detail = await service.findOne(requirement.id);
      expect(detail).toMatchObject(requirement);
      expect(detail.prototypeImport).toEqual(requirement.prototypeImport);
    }
    expect(await service.findOne(ordinaryRequirementId)).toHaveProperty('prototypeImport', null);
  });
});
