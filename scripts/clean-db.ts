/**
 * FlowX local database cleanup.
 *
 * Usage (from repo root):
 *   pnpm db:clean --mode=business --yes
 *   ./scripts/clean-db.sh --mode=all --yes
 *
 * Modes:
 *   all       — delete SQLite file(s) and recreate schema (db push)
 *   business  — remove workspaces/projects/requirements/workflows/issues/bugs (keep users & auth)
 *   workflows — remove workflow runs and related artifacts only
 *   sessions  — remove login sessions and OAuth transient state (keep users)
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

type CleanMode = 'all' | 'business' | 'workflows' | 'sessions';

const MODES: CleanMode[] = ['all', 'business', 'workflows', 'sessions'];

function parseArgs(argv: string[]) {
  let mode: CleanMode = 'business';
  let yes = false;
  let flowxData = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg === '--flowx-data') {
      flowxData = true;
      continue;
    }
    const modeMatch = arg.match(/^--mode=(.+)$/);
    if (modeMatch) {
      const value = modeMatch[1] as CleanMode;
      if (!MODES.includes(value)) {
        throw new Error(`Unknown mode "${value}". Choose: ${MODES.join(', ')}`);
      }
      mode = value;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mode, yes, flowxData };
}

function printHelp() {
  console.log(`FlowX database cleanup

Usage:
  pnpm db:clean [options]
  ./scripts/clean-db.sh [options]

Options:
  --mode=<mode>   ${MODES.join(' | ')}  (default: business)
  --yes, -y       skip confirmation prompt
  --flowx-data    also remove .flowx-data/ runtime directory
  -h, --help      show this help

Examples:
  pnpm db:clean --mode=business --yes
  pnpm db:clean --mode=all --yes
  pnpm db:clean --mode=sessions
`);
}

function loadEnvFile(repoRoot: string) {
  const envPath = resolve(repoRoot, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function resolveDatabasePath(repoRoot: string): string | null {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith('file:')) {
    return null;
  }
  const raw = url.slice('file:'.length);
  if (raw.startsWith('/')) {
    return raw;
  }
  return resolve(repoRoot, raw.startsWith('./') ? raw : `./${raw}`);
}

function confirm(message: string): boolean {
  process.stdout.write(`${message} [y/N] `);
  const answer = readFileSync(0, 'utf8').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

async function cleanWorkflowData(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.reviewFinding.deleteMany();
    await tx.issue.deleteMany({ where: { workflowRunId: { not: null } } });
    await tx.bug.deleteMany({
      where: {
        OR: [{ workflowRunId: { not: null } }, { fixWorkflowRunId: { not: null } }],
      },
    });
    await tx.reviewReport.deleteMany();
    await tx.codeExecution.deleteMany();
    await tx.plan.deleteMany();
    await tx.task.deleteMany();
    await tx.stageExecution.deleteMany();
    await tx.workflowRepository.deleteMany();
    await tx.deployJobRecord.deleteMany({ where: { workflowRunId: { not: null } } });
    await tx.workflowRun.deleteMany();
  });
}

async function cleanBusinessData(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.reviewFinding.deleteMany();
    await tx.issue.deleteMany();
    await tx.bug.deleteMany();
    await tx.reviewReport.deleteMany();
    await tx.codeExecution.deleteMany();
    await tx.plan.deleteMany();
    await tx.task.deleteMany();
    await tx.stageExecution.deleteMany();
    await tx.workflowRepository.deleteMany();
    await tx.deployJobRecord.deleteMany();
    await tx.workflowRun.deleteMany();
    await tx.ideationSessionEvent.deleteMany();
    await tx.ideationSession.deleteMany();
    await tx.ideationArtifact.deleteMany();
    await tx.requirementAssignment.deleteMany();
    await tx.requirementRepository.deleteMany();
    await tx.requirement.deleteMany();
    await tx.projectDeployConfig.deleteMany();
    await tx.repositoryDeployConfig.deleteMany();
    await tx.repository.deleteMany();
    await tx.project.deleteMany();
    await tx.workspace.deleteMany();
  });
}

async function cleanSessions(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.userSession.deleteMany();
    await tx.oAuthState.deleteMany();
    await tx.pendingOrganizationSelection.deleteMany();
  });
}

function resetDatabaseFiles(repoRoot: string) {
  const candidates = new Set<string>();
  const fromEnv = resolveDatabasePath(repoRoot);
  if (fromEnv) {
    candidates.add(fromEnv);
    candidates.add(`${fromEnv}-journal`);
    candidates.add(`${fromEnv}-wal`);
    candidates.add(`${fromEnv}-shm`);
  }
  for (const name of ['dev.db', 'dev-current.db', 'prisma/dev.db']) {
    const path = resolve(repoRoot, name);
    candidates.add(path);
    candidates.add(`${path}-journal`);
    candidates.add(`${path}-wal`);
    candidates.add(`${path}-shm`);
  }

  const removed: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }
    unlinkSync(path);
    removed.push(path);
  }
  return removed;
}

function runDbPush(repoRoot: string) {
  const result = spawnSync(
    'pnpm',
    ['--filter', 'flowx-api', 'exec', 'prisma', 'db', 'push', '--schema', '../../prisma/schema.prisma'],
    { cwd: repoRoot, stdio: 'inherit', env: process.env },
  );
  if (result.status !== 0) {
    throw new Error('prisma db push failed');
  }
}

function removeFlowxData(repoRoot: string) {
  const dir = resolve(repoRoot, '.flowx-data');
  if (!existsSync(dir)) {
    return false;
  }
  spawnSync('rm', ['-rf', dir], { stdio: 'inherit' });
  return true;
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(repoRoot);
  loadEnvFile(repoRoot);

  const { mode, yes, flowxData } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDatabasePath(repoRoot);
  const dbLabel = dbPath ?? process.env.DATABASE_URL ?? '(DATABASE_URL not set)';

  const summary =
    mode === 'all'
      ? `FULL RESET: delete SQLite files and recreate schema.\n  DB: ${dbLabel}`
      : mode === 'business'
        ? `Delete all business data (workspaces → workflows). Keep users & credentials.\n  DB: ${dbLabel}`
        : mode === 'workflows'
          ? `Delete workflow runs and related artifacts only.\n  DB: ${dbLabel}`
          : `Delete sessions and OAuth transient state. Keep users.\n  DB: ${dbLabel}`;

  console.log(`\n${summary}\n`);
  if (!yes && !confirm('Continue?')) {
    console.log('Aborted.');
    process.exit(0);
  }

  if (mode === 'all') {
    const removed = resetDatabaseFiles(repoRoot);
    if (removed.length === 0) {
      console.log('No database files found to remove.');
    } else {
      console.log('Removed:');
      for (const path of removed) {
        console.log(`  - ${path}`);
      }
    }
    console.log('\nRecreating schema (prisma db push)...');
    runDbPush(repoRoot);
    if (flowxData && removeFlowxData(repoRoot)) {
      console.log('Removed .flowx-data/');
    }
    console.log('\nDone. Database reset complete.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    if (mode === 'business') {
      await cleanBusinessData(prisma);
    } else if (mode === 'workflows') {
      await cleanWorkflowData(prisma);
    } else {
      await cleanSessions(prisma);
    }
    if (flowxData && removeFlowxData(repoRoot)) {
      console.log('Removed .flowx-data/');
    }
    console.log(`\nDone. Mode "${mode}" completed.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
