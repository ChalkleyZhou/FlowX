/**
 * Backfill organization admin roles for legacy data.
 *
 * For each organization with no admin, promote the earliest member (by joinedAt).
 * Safe to run multiple times (idempotent).
 *
 * Usage (from repo root):
 *   pnpm db:backfill-admins
 *   pnpm db:backfill-admins --yes
 *   pnpm db:backfill-admins --dry-run
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

type BackfillRow = {
  organizationId: string;
  organizationName: string;
  userId: string;
  displayName: string;
  joinedAt: Date;
};

function parseArgs(argv: string[]) {
  let yes = false;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { yes, dryRun };
}

function printHelp() {
  console.log(`FlowX organization admin backfill

Usage:
  pnpm db:backfill-admins [options]
  ./scripts/backfill-organization-admins.sh [options]

Options:
  --dry-run       print planned changes without writing
  --yes, -y       skip confirmation prompt
  -h, --help      show this help

Docker (container name defaults to flowx):
  sh docker/backfill-organization-admins.sh
  sh docker/backfill-organization-admins.sh --dry-run
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

function confirm(message: string): boolean {
  process.stdout.write(`${message} [y/N] `);
  const answer = readFileSync(0, 'utf8').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

export async function planOrganizationAdminBackfill(prisma: PrismaClient) {
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  const planned: BackfillRow[] = [];
  const skippedWithAdmin: string[] = [];
  const skippedNoMembers: string[] = [];

  for (const organization of organizations) {
    const adminCount = await prisma.userOrganization.count({
      where: { organizationId: organization.id, role: 'admin' },
    });
    if (adminCount > 0) {
      skippedWithAdmin.push(organization.name);
      continue;
    }

    const earliest = await prisma.userOrganization.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, displayName: true } } },
    });
    if (!earliest) {
      skippedNoMembers.push(organization.name);
      continue;
    }

    planned.push({
      organizationId: organization.id,
      organizationName: organization.name,
      userId: earliest.user.id,
      displayName: earliest.user.displayName,
      joinedAt: earliest.createdAt,
    });
  }

  return { planned, skippedWithAdmin, skippedNoMembers };
}

export async function applyOrganizationAdminBackfill(prisma: PrismaClient, planned: BackfillRow[]) {
  for (const row of planned) {
    await prisma.userOrganization.update({
      where: {
        userId_organizationId: {
          userId: row.userId,
          organizationId: row.organizationId,
        },
      },
      data: { role: 'admin' },
    });
  }
}

async function main() {
  const { yes, dryRun } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  loadEnvFile(repoRoot);

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Create .env or export DATABASE_URL before running.');
  }

  const prisma = new PrismaClient();
  try {
    const { planned, skippedWithAdmin, skippedNoMembers } = await planOrganizationAdminBackfill(prisma);

    console.log(`Database: ${process.env.DATABASE_URL}`);
    console.log(`Organizations to update: ${planned.length}`);
    if (skippedWithAdmin.length > 0) {
      console.log(`Already have admin (${skippedWithAdmin.length}): ${skippedWithAdmin.join(', ')}`);
    }
    if (skippedNoMembers.length > 0) {
      console.log(`No members (${skippedNoMembers.length}): ${skippedNoMembers.join(', ')}`);
    }

    for (const row of planned) {
      console.log(
        `  - ${row.organizationName}: promote ${row.displayName} (${row.userId}) joined ${row.joinedAt.toISOString()}`,
      );
    }

    if (planned.length === 0) {
      console.log('\nNothing to backfill.');
      return;
    }

    if (dryRun) {
      console.log('\nDry run only — no changes written.');
      return;
    }

    if (!yes && !confirm('\nApply admin backfill?')) {
      console.log('Cancelled.');
      return;
    }

    await applyOrganizationAdminBackfill(prisma, planned);
    console.log(`\nDone. Promoted ${planned.length} member(s) to organization admin.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
