import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';

it('新增表迁移和重复 db push 保留既有工作流与分支交付数据', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowx-branch-migration-'));
  const url = `file:${join(directory, 'test.db')}`;
  const schemaPath = resolve('../../prisma/schema.prisma');
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const env = { ...process.env, DATABASE_URL: url };
  const baselinePath = join(directory, 'baseline.prisma');
  const schema = readFileSync(schemaPath, 'utf8');
  writeFileSync(baselinePath, schema.replace(/model CodeBranchSubmission \{[\s\S]*?\n\}\n\n/, '').replace(/^.*codeBranchSubmissions CodeBranchSubmission\[\].*\n/gm, ''));
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', baselinePath, '--script'], { env, encoding: 'utf8' });
    execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: sql });
    const organization = await prisma.organization.create({ data: { name: '既有组织', provider: 'test', providerOrganizationId: 'migration' } });
    const workspace = await prisma.workspace.create({ data: { name: '既有空间', organizationId: organization.id } });
    const project = await prisma.project.create({ data: { name: '既有项目', workspaceId: workspace.id } });
    const requirement = await prisma.requirement.create({ data: { title: '保留既有需求', description: '', acceptanceCriteria: '', projectId: project.id, workspaceId: workspace.id } });
    const workflow = await prisma.workflowRun.create({ data: { requirementId: requirement.id, status: 'EXECUTION_RUNNING', currentStage: 'EXECUTION' } });
    const stage = await prisma.stageExecution.create({ data: { workflowRunId: workflow.id, stage: 'EXECUTION', status: 'RUNNING' } });
    const repository = await prisma.workflowRepository.create({ data: { workflowRunId: workflow.id, name: 'web', url: 'https://example.com/web.git', baseBranch: 'main', workingBranch: 'feature/a' } });
    const user = await prisma.user.create({ data: { displayName: '既有用户' } });
    const migration = readFileSync(resolve('../../prisma/migrations/20261022070000_add_code_branch_submissions/migration.sql'), 'utf8');
    execFileSync(process.execPath, [cli, 'db', 'execute', '--url', url, '--stdin'], { env, input: migration });
    const submission = await prisma.codeBranchSubmission.create({ data: { workflowRunId: workflow.id, stageExecutionId: stage.id, workflowRepositoryId: repository.id, submittedByUserId: user.id, branch: 'feature/a', headSha: 'a'.repeat(40) } });
    for (let index = 0; index < 2; index++) execFileSync(process.execPath, [cli, 'db', 'push', '--schema', schemaPath, '--skip-generate'], { env });
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } })).title).toBe('保留既有需求');
    expect(await prisma.codeBranchSubmission.findUniqueOrThrow({ where: { id: submission.id } })).toEqual(submission);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe('EXECUTION_RUNNING');
  } finally { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
