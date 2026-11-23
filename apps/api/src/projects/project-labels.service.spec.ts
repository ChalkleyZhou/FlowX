import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectLabelsService } from './project-labels.service';
import { WorkItemsService } from '../work-items/work-items.service';
import { ReviewArtifactsService } from '../review-artifacts/review-artifacts.service';
const directory = mkdtempSync(join(tmpdir(), 'flowx-labels-'));
const url = `file:${join(directory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const labels = new ProjectLabelsService(prisma as never);
const items = new WorkItemsService(prisma as never, {} as never);
const bugs = new ReviewArtifactsService(prisma as never, {} as never);
let projectId: string, versionId: string, otherId: string, org: string, workspaceId: string;
const auth = () => ({ organization: { id: org } });
beforeAll(async () => {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', resolve('../../prisma/schema.prisma'), '--script'], { env, encoding: 'utf8' });
  execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
  org = (await prisma.organization.create({ data: { provider: 'test', providerOrganizationId: 'labels-test', name: '测试' } })).id;
  workspaceId = (await prisma.workspace.create({ data: { name: '工作区', organizationId: org } })).id;
  const project = await prisma.project.create({ data: { name: '项目', workspaceId, versions: { create: { name: 'v1' } } }, include: { versions: true } });
  projectId = project.id; versionId = project.versions[0].id;
  otherId = (await prisma.project.create({ data: { name: '其他', workspaceId } })).id;
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

it.each(['REQUIREMENT', 'ISSUE', 'BUG'] as const)('版本工作项 %s 按创建时间倒序，编辑后翻页不重复或遗漏', async (kind) => {
  const title = `created-order-${kind}`;
  const project = await prisma.project.create({ data: { name: title, workspaceId, versions: { create: { name: 'v1' } } }, include: { versions: true } });
  const projectId = project.id;
  const versionId = project.versions[0].id;
  const older = new Date('2026-01-01T00:00:00.000Z');
  const newer = new Date('2026-01-02T00:00:00.000Z');
  const rows = [];
  for (const [suffix, createdAt] of [['a', older], ['b', newer], ['c', newer]] as const) {
    rows.push(await prisma.workItem.create({ data: {
      id: `${title}-${suffix}`, title, kind, projectId, versionId, workspaceId,
      createdAt, updatedAt: createdAt,
    } }));
  }
  const query = { q: title, kind, pageSize: 1 };
  const first = await items.listByVersion(projectId, versionId, query, auth());
  expect(first.items.map(row => row.id)).toEqual([rows[2].id]);
  expect(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')))
    .toEqual({ createdAt: newer.toISOString(), id: rows[2].id });

  const label = await labels.create(projectId, { name: `排序-${kind}` }, auth());
  await items.update(rows[0].id, { description: '编辑描述', labelIds: [label.id] }, auth());
  await items.update(rows[2].id, { remark: '已读记录也发生编辑' }, auth());
  const second = await items.listByVersion(projectId, versionId, { ...query, cursor: first.nextCursor! }, auth());
  const third = await items.listByVersion(projectId, versionId, { ...query, cursor: second.nextCursor! }, auth());
  expect(second.items.map(row => row.id)).toEqual([rows[1].id]);
  expect(third.items.map(row => row.id)).toEqual([rows[0].id]);
  expect(third.nextCursor).toBeNull();
  const page = await items.listGlobal({ projectId, versionId, kind, q: title, pageSize: 10 }, auth());
  expect(page.items.map(row => row.id)).toEqual([rows[2].id, rows[1].id, rows[0].id]);

  const legacyCursor = Buffer.from(JSON.stringify({ updatedAt: newer.toISOString(), id: rows[2].id })).toString('base64url');
  const legacyNext = await items.listByVersion(projectId, versionId, { ...query, cursor: legacyCursor }, auth());
  expect(legacyNext.items.map(row => row.id)).toEqual([rows[1].id]);
  const otherVersion = await prisma.projectVersion.create({ data: { projectId, name: 'v2' } });
  await expect(items.listByVersion(projectId, otherVersion.id, { ...query, cursor: legacyCursor }, auth()))
    .rejects.toMatchObject({ status: 400 });
});

describe('项目标签事务、隔离与兼容', () => {
  it('项目内规范名称唯一，默认颜色，分页，组织隔离', async () => {
    const label = await labels.create(projectId, { name: ' 前端 ' }, auth());
    expect(label).toMatchObject({ name: '前端', color: 'BLUE' });
    await expect(labels.create(projectId, { name: '前端' }, auth())).rejects.toMatchObject({ status: 409 });
    await labels.create(otherId, { name: '前端' }, auth());
    await expect(labels.listPage(projectId, {}, { organization: { id: 'other-org' } })).rejects.toMatchObject({ status: 404 });
    await expect(labels.create(projectId, { name: 'bad', color: 'BLACK' }, auth())).rejects.toMatchObject({ status: 400 });
    expect((await labels.listPage(projectId, {}, auth())).items[0]).toMatchObject({ id: label.id, workItemCount: 0 });
    await labels.create(projectId, { name: 'API' }, auth());
    await expect(labels.create(projectId, { name: 'api' }, auth())).rejects.toMatchObject({ status: 409 });
  });
  it('工作项原子绑定、保留、清空、OR筛选、无效标签回滚与并发', async () => {
    const a = await labels.create(projectId, { name: '事务A' }, auth());
    const b = await labels.create(projectId, { name: '事务B' }, auth());
    const other = await labels.create(otherId, { name: '外部' }, auth());
    const item = await items.create(projectId, versionId, { kind: 'REQUIREMENT', title: '原始', labelIds: [a.id] }, auth());
    expect(item.labels).toEqual([{ id: a.id, name: a.name, color: a.color }]);
    expect((await items.update(item.id, { title: '修改' }, auth())).labels).toHaveLength(1);
    await expect(items.update(item.id, { title: '不应保存', labelIds: [other.id] }, auth())).rejects.toMatchObject({ status: 404 });
    expect((await items.findOne(item.id, auth())).title).toBe('修改');
    await expect(items.update(item.id, { labelIds: null } as never, auth())).rejects.toMatchObject({ status: 400 });
    await expect(items.update(item.id, { labelIds: [b.id], updatedAt: '2000-01-01T00:00:00.000Z' }, auth())).rejects.toMatchObject({ status: 409 });
    expect((await items.listGlobal({ labelIds: `${a.id},${b.id}` }, auth())).items.map(row => row.id)).toContain(item.id);
    expect((await items.listByVersion(projectId, versionId, { labelIds: b.id }, auth())).items).toEqual([]);
    await items.update(item.id, { labelIds: [] }, auth());
    expect((await items.findOne(item.id, auth())).labels).toEqual([]);
    await items.update(item.id, { labelIds: [b.id] }, auth());
    expect(await labels.remove(projectId, b.id, auth())).toEqual({ ok: true, removedAssociations: 1 });
    await expect(items.update(item.id, { labelIds: [b.id] }, auth())).rejects.toMatchObject({ status: 404 });
    expect((await items.findOne(item.id, auth())).labels).toEqual([]);
  });
  it('缺陷专用接口保留字段并使用相同标签事务和筛选', async () => {
    const a = await labels.create(projectId, { name: '缺陷' }, auth());
    const bug = await bugs.createBug({ workspaceId, projectId, title: '缺陷', description: '复现', reproductionSteps: ['步骤'], labelIds: [a.id] }, null);
    expect(bug.labels).toHaveLength(1);
    expect((await bugs.getBugsPage({ labelIds: a.id })).items.map(row => row.id)).toContain(bug.id);
    await bugs.updateBug(bug.id, { labelIds: [], actualBehavior: '实际结果' });
    expect((await bugs.getBug(bug.id)).labels).toEqual([]);
  });
});

it('并发重名只有一个成功，标签CAS拒绝旧版本且不泄漏其他项目', async () => {
  const results = await Promise.allSettled([
    labels.create(projectId, { name: 'Concurrent' }, auth()),
    labels.create(projectId, { name: 'CONCURRENT' }, auth()),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const label = await labels.create(projectId, { name: '编辑' }, auth());
  await expect(labels.update(projectId, label.id, { name: '不应保存', updatedAt: '2000-01-01T00:00:00.000Z' }, auth())).rejects.toMatchObject({ status: 409 });
  await expect(labels.update(otherId, label.id, { color: 'RED' }, auth())).rejects.toMatchObject({ status: 404 });
  expect(await labels.update(projectId, label.id, { color: 'RED', updatedAt: label.updatedAt.toISOString() }, auth())).toMatchObject({ name: '编辑', color: 'RED' });
});

it('Issue 读取路径也投影摘要，不暴露关联表', async () => {
  const label = await labels.create(projectId, { name: 'Issue摘要' }, auth());
  const item = await items.create(projectId, versionId, { kind: 'ISSUE', title: 'Issue', labelIds: [label.id] }, auth());
  expect((await bugs.getIssue(item.id)).labels).toEqual([{ id: label.id, name: label.name, color: label.color }]);
});

it.each([
  { kind: 'REQUIREMENT' as const, firstStatus: 'ACTIVE', secondStatus: 'DONE', openCount: 0, inProgressCount: 24, completedCount: 7 },
  { kind: 'ISSUE' as const, firstStatus: 'OPEN', secondStatus: 'IN_PROGRESS', openCount: 24, inProgressCount: 7, completedCount: 0 },
])('通用列表 $kind 统计覆盖分页之外且与标签和其他条件取交集', async ({ kind, firstStatus, secondStatus, openCount, inProgressCount, completedCount }) => {
  const a = await labels.create(projectId, { name: `${kind}统计A` }, auth());
  const b = await labels.create(projectId, { name: `${kind}统计B` }, auth());
  const c = await labels.create(projectId, { name: `${kind}不匹配` }, auth());
  const seed = (index: number, overrides: { labelId?: string; title?: string; priority?: string; versionId?: string | null } = {}) => prisma.workItem.create({ data: {
    kind, projectId, workspaceId, versionId: overrides.versionId === undefined ? versionId : overrides.versionId,
    title: overrides.title ?? `summary-match-${index}`, priority: overrides.priority ?? 'HIGH',
    status: index < 24 ? firstStatus : secondStatus,
    labels: { create: { labelId: overrides.labelId ?? (index % 2 ? a.id : b.id) } },
  } });
  for (let index = 0; index < 31; index += 1) await seed(index);
  await seed(0, { labelId: c.id });
  await seed(0, { priority: 'LOW' });
  await seed(0, { title: '其他关键词' });
  await seed(0, { versionId: null });
  const query = { kind, projectId, versionId, priority: 'HIGH', q: 'summary-match', labelIds: `${a.id},${b.id}`, pageSize: 20 };
  const first = await items.listGlobal({ ...query, page: 1 }, auth());
  const second = await items.listGlobal({ ...query, page: 2 }, auth());
  const summary = { total: 31, visible: 31, visibleCount: 31, openCount, inProgressCount, completedCount };
  expect(first).toMatchObject({ total: 31, page: 1, pageSize: 20, totalPages: 2, summary });
  expect(first.items).toHaveLength(20);
  expect(second).toMatchObject({ total: 31, page: 2, pageSize: 20, totalPages: 2, summary });
  expect(second.items).toHaveLength(11);
  const statusFiltered = await items.listGlobal({ ...query, status: firstStatus }, auth());
  expect(statusFiltered).toMatchObject({ total: 24, summary: { total: 24, visible: 24, inProgressCount: kind === 'REQUIREMENT' ? 24 : 0, openCount: kind === 'ISSUE' ? 24 : 0, completedCount: 0 } });
  expect((await items.listGlobal({ ...query, q: '不存在关键词' }, auth())).summary).toEqual({ total: 0, visible: 0, visibleCount: 0, openCount: 0, inProgressCount: 0, completedCount: 0 });
});
