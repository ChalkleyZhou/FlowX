import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaseLibrariesService } from './case-libraries.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-case-numbering-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const peer = new PrismaClient({ datasources: { db: { url } } });
const service = new CaseLibrariesService(prisma as never);
const peerService = new CaseLibrariesService(peer as never);
const definition = { title: '登录', steps: ['登录'], expected: '成功' };
let workspaceId: string;

beforeAll(async () => {
  const cli = createRequire(resolve('package.json')).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  const organization = await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: directory, name: '编号测试组织' } });
  workspaceId = (await prisma.workspace.create({ data: { name: '编号测试空间', organizationId: organization.id } })).id;
}, 30_000);

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), peer.$disconnect()]);
  rmSync(directory, { recursive: true, force: true });
});

async function library() {
  return prisma.testCaseLibrary.create({ data: { workspaceId, name: '回归库', scope: 'WORKSPACE' } });
}

describe('用例自动编号', () => {
  it('同一库跨模块递增，归档后不复用编号，不同库从一开始', async () => {
    const firstLibrary = await library();
    const module = await service.createModule(firstLibrary.id, { name: '认证' });
    const first = await service.createCase(firstLibrary.id, definition);
    const second = await service.createCase(firstLibrary.id, { ...definition, moduleId: module.id, externalId: '  ' });
    expect(first.externalId).toBe('TC-000001');
    expect(second.externalId).toBe('TC-000002');
    await service.deleteCase(second.id);
    expect((await service.createCase(firstLibrary.id, definition)).externalId).toBe('TC-000003');
    expect((await service.createCase((await library()).id, definition)).externalId).toBe('TC-000001');
  });

  it.each([false, true])('导入保留原编号，空编号自动分配，模块自动创建=%s', async (autoCreateModules) => {
    const target = await library();
    await service.createCase(target.id, { ...definition, externalId: 'LOGIN-001' });
    await service.importCases(target.id, {
      autoCreateModules,
      cases: [
        { ...definition, title: '空编号' },
        { ...definition, title: '保留编号', externalId: 'TC-000002' },
        { ...definition, title: '第二个空编号', externalId: '  ' },
      ],
    });
    const cases = await prisma.testCaseDefinition.findMany({ where: { libraryId: target.id } });
    const ids = cases.map(item => item.externalId);
    expect(ids).toContain('LOGIN-001');
    expect(ids).toContain('TC-000002');
    expect(ids.every(id => Boolean(id))).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect((await service.createCase(target.id, definition)).externalId).toBe('TC-000005');
  });

  it('自动编号跳过包含归档记录在内的已有流水号', async () => {
    const target = await library();
    await prisma.testCaseDefinition.create({ data: { libraryId: target.id, ...definition, externalId: 'TC-000010', status: 'ARCHIVED' } });
    expect((await service.createCase(target.id, definition)).externalId).toBe('TC-000011');
  });

  it('最高编号的用例移动到其他库后，原库也不回退计数器', async () => {
    const source = await library();
    const target = await library();
    const created = await service.createCase(source.id, definition);
    await service.updateCase(created.id, { libraryId: target.id });
    expect((await service.createCase(source.id, definition)).externalId).toBe('TC-000002');
    expect((await service.createCase(target.id, definition)).externalId).toBe('TC-000002');
  });

  it('拒绝重复的显式编号，失败后仍可继续自动编号', async () => {
    const target = await library();
    await service.createCase(target.id, { ...definition, externalId: 'TC-000001' });
    await expect(service.createCase(target.id, { ...definition, externalId: 'TC-000001' })).rejects.toThrow('已存在');
    await expect(service.importCases(target.id, { cases: [definition, { ...definition, externalId: 'TC-000001' }] })).rejects.toThrow('已存在');
    expect((await service.createCase(target.id, definition)).externalId).toBe('TC-000002');
    expect(await prisma.testCaseDefinition.count({ where: { libraryId: target.id } })).toBe(2);
  });

  it('两个数据库连接并发新建与导入不会生成重复编号', async () => {
    const target = await library();
    await Promise.all([
      service.createCase(target.id, definition),
      peerService.createCase(target.id, definition),
      service.importCases(target.id, { cases: [definition, definition] }),
    ]);
    const cases = await prisma.testCaseDefinition.findMany({ where: { libraryId: target.id }, orderBy: { externalId: 'asc' } });
    expect(cases.map(item => item.externalId)).toEqual(['TC-000001', 'TC-000002', 'TC-000003', 'TC-000004']);
  });

  it('失败的导入回滚序号与用例写入', async () => {
    const target = await library();
    await expect(service.importCases(target.id, { cases: [{ ...definition, moduleName: '不存在' }] })).rejects.toThrow('不存在');
    expect((await service.createCase(target.id, definition)).externalId).toBe('TC-000001');
    expect(await prisma.testCaseDefinition.count({ where: { libraryId: target.id } })).toBe(1);
  });
});
