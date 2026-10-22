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

  it('详情与列表使用相同的最小导入摘要契约', async () => {
    for (const requirement of importedRequirements) {
      const detail = await service.findOne(requirement.id);
      expect(detail).toMatchObject(requirement);
      expect(detail.prototypeImport).toEqual(requirement.prototypeImport);
    }
    expect(await service.findOne(ordinaryRequirementId)).toHaveProperty('prototypeImport', null);
  });
});
