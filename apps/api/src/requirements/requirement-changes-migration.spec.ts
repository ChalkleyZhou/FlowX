import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

it('统一工作项的需求变更数据可重复 db push 且保持关联', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowx-changes-migration-'));
  const url = `file:${join(directory, 'test.db')}`;
  const schemaPath = resolve('../../prisma/schema.prisma');
  const baselinePath = join(directory, 'baseline.prisma');
  const schema = readFileSync(schemaPath, 'utf8');
  writeFileSync(baselinePath, schema);
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselinePath, '--script'], { env, encoding: 'utf8' });
    execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
    const organization = await prisma.organization.create({ data: { name: '历史组织', provider: 'test', providerOrganizationId: 'changes-migration' } });
    const workspace = await prisma.workspace.create({ data: { name: '历史空间', organizationId: organization.id } });
    const project = await prisma.project.create({ data: { name: '历史项目', workspaceId: workspace.id } });
    await prisma.$executeRaw`INSERT INTO WorkItem (id,kind,status,title,description,acceptanceCriteria,projectId,workspaceId,updatedAt) VALUES ('legacy-req','REQUIREMENT','ACTIVE','原始标题','原始描述','原始验收',${project.id},${workspace.id},CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`INSERT INTO WorkflowRun (id,workItemId,status,updatedAt) VALUES ('legacy-run','legacy-req','DONE',CURRENT_TIMESTAMP)`;
    const stage = await prisma.stageExecution.create({ data: { workflowRunId: 'legacy-run', stage: 'SPEC_PLAN', status: 'COMPLETED', output: { original: '历史方案' } } });
    await prisma.requirementChange.create({ data: {
      id: 'legacy-change', workItemId: 'legacy-req', revision: 1, content: '历史变更', mode: 'SUPPLEMENT',
      requestId: 'old-request', createdByUserId: 'author', createdByName: '产品', prototype: null,
    } });
    expect(await prisma.requirementChange.findUniqueOrThrow({ where: { id: 'legacy-change' } })).toMatchObject({ content: '历史变更', prototype: null });
    for (let index = 0; index < 2; index++) execFileSync(process.execPath, [cli, 'db', 'push', '--schema', schemaPath, '--skip-generate'], { env });
    expect(await prisma.workItem.findUniqueOrThrow({ where: { id: 'legacy-req' } })).toMatchObject({ title: '原始标题', description: '原始描述', revision: 0 });
    expect(await prisma.workflowRun.findUniqueOrThrow({ where: { id: 'legacy-run' } })).toMatchObject({ status: 'DONE', sourceChangeId: null, supersededByChangeId: null });
    expect(await prisma.stageExecution.findUniqueOrThrow({ where: { id: stage.id } })).toEqual(stage);
    expect(await prisma.$queryRaw`PRAGMA foreign_key_check`).toEqual([]);
  } finally { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
