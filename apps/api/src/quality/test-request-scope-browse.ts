import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageResult, parsePagination, type PaginationQuery } from '../common/pagination';
import type { PrismaService } from '../prisma/prisma.service';

export type ScopeBrowseQuery = PaginationQuery & { q?: string; action?: string; view?: string; libraryId?: string; moduleId?: string };

export async function scopeModuleIds(prisma: PrismaService, moduleId: string, workspaceId: string, projectId: string) {
  const module = await prisma.testCaseModule.findFirst({ where: { id: moduleId, library: { workspaceId, OR: [{ projectId: null }, { projectId }] } } });
  if (!module) throw new BadRequestException('模块不属于当前项目或共享用例库。');
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH RECURSIVE descendants(id) AS (SELECT id FROM TestCaseModule WHERE id = ${moduleId} UNION SELECT m.id FROM TestCaseModule m JOIN descendants d ON m.parentId = d.id WHERE m.libraryId = ${module.libraryId}) SELECT id FROM descendants`);
  return rows.map(item => item.id);
}

/** 为网页提供分页工作台；旧草稿查询仍由原入口保持兼容。 */
export async function browseScope(prisma: PrismaService, id: string, query: ScopeBrowseQuery) {
  if (!['selected', 'library'].includes(query.view ?? '')) throw new BadRequestException('不支持的范围视图。');
  const request = await prisma.testRequest.findUnique({ where: { id }, select: { id: true, workspaceId: true, projectId: true, testDesignId: true, scopeRevision: true, scopeGenerationStatus: true, testDesign: { select: { status: true } } } });
  if (!request) throw new NotFoundException('Test request not found.');
  const paging = parsePagination(query);
  const moduleIds = query.moduleId ? await scopeModuleIds(prisma, query.moduleId, request.workspaceId, request.projectId) : undefined;
  const definitionFilter: Prisma.TestCaseDefinitionWhereInput = {
    library: { workspaceId: request.workspaceId, OR: [{ projectId: null }, { projectId: request.projectId }] },
    ...(query.libraryId ? { libraryId: query.libraryId } : {}),
    ...(moduleIds ? { moduleId: { in: moduleIds } } : {}),
  };
  const base: Prisma.TestDesignCandidateWhereInput = { testDesignId: request.testDesignId ?? '__none__' };
  const selected: Prisma.TestDesignCandidateWhereInput = { ...base, action: { not: 'EXCLUDE' }, resolution: { not: 'REJECTED' } };
  const filtered: Prisma.TestDesignCandidateWhereInput = {
    ...selected,
    ...((query.libraryId || moduleIds) ? { sourceDefinition: definitionFilter } : {}),
  };
  const keyword = query.q?.trim();
  const [included, matchingIncluded, available] = await Promise.all([
    prisma.testDesignCandidate.count({ where: selected }),
    prisma.testDesignCandidate.count({ where: filtered }),
    prisma.testCaseDefinition.count({ where: { ...definitionFilter, status: 'ACTIVE' } }),
  ]);
  const metadata = { scopeRevision: request.scopeRevision, status: request.scopeGenerationStatus, designStatus: request.testDesign?.status, summary: { included, matchingIncluded, available } };
  if (query.view === 'selected') {
    const where: Prisma.TestDesignCandidateWhereInput = { ...filtered, ...(keyword ? { proposedCase: { path: '$.title', string_contains: keyword } } : {}) };
    const [items, total] = await Promise.all([
      prisma.testDesignCandidate.findMany({ where, include: { sourceDefinition: { include: { library: true, module: true } } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], skip: paging.skip, take: paging.take }),
      prisma.testDesignCandidate.count({ where }),
    ]);
    return { ...pageResult(items, total, paging), ...metadata };
  }
  const where: Prisma.TestCaseDefinitionWhereInput = {
    ...definitionFilter, status: 'ACTIVE',
    ...(keyword ? { OR: [{ title: { contains: keyword } }, { externalId: { contains: keyword } }] } : {}),
  };
  const [definitions, total] = await Promise.all([
    prisma.testCaseDefinition.findMany({ where, include: { library: true, module: true }, orderBy: [{ title: 'asc' }, { id: 'asc' }], skip: paging.skip, take: paging.take }),
    prisma.testCaseDefinition.count({ where }),
  ]);
  const candidates = await prisma.testDesignCandidate.findMany({ where: { ...base, sourceDefinitionId: { in: definitions.map(item => item.id) } }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const byDefinition = new Map(candidates.map(candidate => [candidate.sourceDefinitionId, candidate]));
  const items = definitions.map(definition => {
    const candidate = byDefinition.get(definition.id);
    return candidate ? { ...candidate, sourceDefinition: definition } : {
      id: `library:${definition.id}`, action: 'REUSE', resolution: 'REJECTED', sourceDefinitionId: definition.id, sourceVersion: definition.version, coverageKeys: [],
      proposedCase: { title: definition.title, priority: definition.priority, precondition: definition.precondition, testData: definition.testData, targetKeys: definition.targetKeys, steps: definition.steps, expected: definition.expected, tags: definition.tags },
      sourceDefinition: definition,
    };
  });
  return { ...pageResult(items, total, paging), ...metadata };
}
