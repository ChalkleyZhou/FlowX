/**
 * 补齐历史云效成员映射中的 memberId、userId 和 aliyunAccountId。
 * 默认只在确认后写入；脚本只更新已有映射，不创建或删除映射。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

type BackfillResult = {
  mappingId: string;
  displayName: string;
  status: 'READY' | 'SKIP' | 'ERROR';
  yunxiaoMemberId: string | null;
  yunxiaoUserId: string | null;
  aliyunAccountId: string | null;
  reason?: string;
};

function parseArgs(argv: string[]) {
  let yes = false;
  let dryRun = false;
  let organizationId: string | null = null;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const match = arg.match(/^--organization(?:-id)?=(.+)$/);
    if (match) {
      organizationId = match[1].trim() || null;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { yes, dryRun, organizationId };
}

function printHelp() {
  console.log(`云效成员映射数据回填

Usage:
  pnpm db:backfill-yunxiao-mappings [options]
  ./scripts/backfill-yunxiao-member-mappings.sh [options]

Options:
  --dry-run                 查询并打印计划，不写数据库
  --yes, -y                 跳过确认直接写入
  --organization=<id>       只处理指定 FlowX organizationId
  --organization-id=<id>    --organization 的别名
  -h, --help                显示帮助

Environment:
  DATABASE_URL
  YUNXIAO_PERSONAL_ACCESS_TOKEN
  YUNXIAO_API_ENDPOINT      可选，默认 https://openapi-rdc.aliyuncs.com
`);
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function confirm(message: string) {
  process.stdout.write(`${message} [y/N] `);
  const answer = readFileSync(0, 'utf8').trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

function normalize(value: string | null | undefined) {
  const result = value?.trim();
  return result || null;
}

function getApiEndpoint() {
  const configured = normalize(process.env.YUNXIAO_API_ENDPOINT);
  if (!configured) return 'https://openapi-rdc.aliyuncs.com';
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

class YunxiaoApiError extends Error {
  constructor(status: number, path: string) {
    super(`Yunxiao API request failed (${status}): ${path}`);
  }
}

async function fetchJson(url: URL, token: string) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-yunxiao-token': token,
    },
  });
  if (!response.ok) throw new YunxiaoApiError(response.status, url.pathname);
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function findMemberId(value: unknown) {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  const result = asRecord(record?.result);
  return pickString(record?.id, record?.memberId, data?.id, data?.memberId, result?.id, result?.memberId);
}

function findAliyunAccountId(value: unknown) {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  const binds = record && Array.isArray(record.binds)
    ? record.binds
    : data && Array.isArray(data.binds) ? data.binds : [];
  const bind = binds.map((item) => asRecord(item)).find((item) => item?.bindType === 'aliyunAccount');
  return pickString(bind?.bindId);
}

async function resolveIdentity(
  userIdValue: string | null,
  legacyIdentifier: string,
  organizationIdentifier: string,
  token: string,
  endpoint: string,
) {
  const userId = normalize(userIdValue) ?? normalize(legacyIdentifier);
  if (!userId) return { status: 'SKIP' as const, reason: '没有可用的云效 userId。' };
  const memberPath = `/oapi/v1/platform/organizations/${encodeURIComponent(organizationIdentifier)}/members:readByUser?userId=${encodeURIComponent(userId)}`;
  const memberResponse = await fetchJson(new URL(memberPath, endpoint), token);
  const memberId = findMemberId(memberResponse);
  if (!memberId) return { status: 'SKIP' as const, reason: 'ReadMemberByUser 未返回组织成员 ID。', userId };
  const bindPath = `/oapi/v1/platform/organizations/${encodeURIComponent(organizationIdentifier)}/members/${encodeURIComponent(memberId)}/binds`;
  const bindResponse = await fetchJson(new URL(bindPath, endpoint), token);
  const aliyunAccountId = findAliyunAccountId(bindResponse);
  if (!aliyunAccountId) {
    return { status: 'SKIP' as const, reason: 'GetBindInfo 未返回 aliyunAccount bindId。', userId, memberId };
  }
  return { status: 'READY' as const, userId, memberId, aliyunAccountId };
}

async function planBackfill(prisma: PrismaClient, organizationId: string | null) {
  const mappings = await prisma.yunxiaoMemberMapping.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      organizationId: true,
      yunxiaoOrganizationIdentifier: true,
      yunxiaoMemberId: true,
      yunxiaoUserId: true,
      aliyunAccountId: true,
      yunxiaoUserIdentifier: true,
      yunxiaoDisplayName: true,
    },
  });
  const token = normalize(process.env.YUNXIAO_PERSONAL_ACCESS_TOKEN);
  if (!token) throw new Error('YUNXIAO_PERSONAL_ACCESS_TOKEN is not set.');
  const endpoint = getApiEndpoint();
  const results: BackfillResult[] = [];
  for (const mapping of mappings) {
    const base = {
      mappingId: mapping.id,
      displayName: mapping.yunxiaoDisplayName,
      yunxiaoMemberId: mapping.yunxiaoMemberId,
      yunxiaoUserId: mapping.yunxiaoUserId,
      aliyunAccountId: mapping.aliyunAccountId,
    };
    if (mapping.yunxiaoMemberId && mapping.yunxiaoUserId && mapping.aliyunAccountId) {
      results.push({ ...base, status: 'SKIP', reason: '三种身份字段已完整。' });
      continue;
    }
    try {
      const identity = await resolveIdentity(
        mapping.yunxiaoUserId,
        mapping.yunxiaoUserIdentifier,
        mapping.yunxiaoOrganizationIdentifier,
        token,
        endpoint,
      );
      if (identity.status === 'READY') {
        results.push({
          ...base,
          status: 'READY',
          yunxiaoUserId: identity.userId,
          yunxiaoMemberId: identity.memberId,
          aliyunAccountId: identity.aliyunAccountId,
        });
        continue;
      }
      results.push({
        ...base,
        status: 'SKIP',
        reason: identity.reason,
      });
    } catch (error) {
      const reason = error instanceof YunxiaoApiError
        ? error.message
        : error instanceof Error ? error.message : '未知错误';
      results.push({ ...base, status: 'ERROR', reason });
    }
  }
  return results;
}

async function applyBackfill(prisma: PrismaClient, results: BackfillResult[]) {
  let updated = 0;
  for (const result of results) {
    if (result.status !== 'READY' || !result.yunxiaoMemberId || !result.yunxiaoUserId || !result.aliyunAccountId) continue;
    await prisma.yunxiaoMemberMapping.update({
      where: { id: result.mappingId },
      data: {
        yunxiaoMemberId: result.yunxiaoMemberId,
        yunxiaoUserId: result.yunxiaoUserId,
        aliyunAccountId: result.aliyunAccountId,
        yunxiaoUserIdentifier: result.aliyunAccountId,
      },
    });
    updated += 1;
  }
  return updated;
}

async function main() {
  const { yes, dryRun, organizationId } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  loadEnvFile(resolve(repoRoot, '.env'));
  loadEnvFile(resolve(repoRoot, 'prisma/.env'));
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Create .env or export DATABASE_URL before running.');
  }
  const prisma = new PrismaClient();
  try {
    const results = await planBackfill(prisma, organizationId);
    const ready = results.filter((result) => result.status === 'READY');
    const skipped = results.filter((result) => result.status === 'SKIP');
    const errors = results.filter((result) => result.status === 'ERROR');
    console.log(`Database: ${process.env.DATABASE_URL}`);
    console.log(`Mappings: ${results.length}; ready: ${ready.length}; skipped: ${skipped.length}; errors: ${errors.length}`);
    for (const result of results) {
      const details = result.status === 'READY'
        ? `memberId=${result.yunxiaoMemberId} userId=${result.yunxiaoUserId} aliyunAccountId=${result.aliyunAccountId}`
        : result.reason ?? result.status;
      console.log(`  - ${result.displayName} [${result.mappingId}] ${details}`);
    }
    if (ready.length === 0) {
      console.log('\n没有需要回填的映射。');
      return;
    }
    if (dryRun) {
      console.log('\nDry run only — no changes written.');
      return;
    }
    if (!yes && !confirm('\nApply Yunxiao member mapping backfill?')) {
      console.log('Cancelled.');
      return;
    }
    console.log(`\nDone. Updated ${await applyBackfill(prisma, ready)} mapping(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectRun() {
  return process.argv[1]
    ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
