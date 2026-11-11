import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type ScopeModuleStrategy = 'AI_RECOMMENDED' | 'ALL';
export type ScopeExceptionReason = 'AI_NEW_CASE' | 'PENDING_REVIEW' | 'AI_EXCLUDED';

export interface ScopeModuleSummary {
  moduleId: string;
  libraryId: string;
  moduleName: string;
  totalCount: number;
  includedCount: number;
  aiRecommendedCount: number;
  exceptionCount: number;
  status: 'ALL' | 'PARTIAL' | 'NONE';
}

export function scopeExceptionReason(candidate: {
  action: string;
  resolution: string;
  sourceDefinitionId?: string | null;
  decisionNote?: string | null;
}): ScopeExceptionReason | null {
  if (candidate.decisionNote?.trim()) return null;
  if (candidate.action === 'CREATE' && !candidate.sourceDefinitionId) return 'AI_NEW_CASE';
  if (candidate.resolution === 'PENDING') return 'PENDING_REVIEW';
  if (candidate.action === 'EXCLUDE') return 'AI_EXCLUDED';
  return null;
}

export async function scopeModuleIds(prisma: PrismaService, moduleId: string, workspaceId: string, projectId: string) {
  const module = await prisma.testCaseModule.findFirst({ where: { id: moduleId, library: { workspaceId, OR: [{ projectId: null }, { projectId }] } } });
  if (!module) throw new BadRequestException('模块不属于当前项目或共享用例库。');
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH RECURSIVE descendants(id) AS (SELECT id FROM TestCaseModule WHERE id = ${moduleId} UNION SELECT m.id FROM TestCaseModule m JOIN descendants d ON m.parentId = d.id WHERE m.libraryId = ${module.libraryId}) SELECT id FROM descendants`);
  return rows.map(item => item.id);
}

export async function summarizeScopeModules(prisma: PrismaService, request: { workspaceId: string; projectId: string; testDesignId?: string | null }, modules: Array<{ id: string; libraryId: string; name: string }>): Promise<ScopeModuleSummary[]> {
  if (!request.testDesignId || !modules.length) {
    return modules.map(module => ({ moduleId: module.id, libraryId: module.libraryId, moduleName: module.name, totalCount: 0, includedCount: 0, aiRecommendedCount: 0, exceptionCount: 0, status: 'NONE' as const }));
  }
  return Promise.all(modules.map(async module => {
    const moduleIds = await scopeModuleIds(prisma, module.id, request.workspaceId, request.projectId);
    const definitionWhere: Prisma.TestCaseDefinitionWhereInput = { libraryId: module.libraryId, moduleId: { in: moduleIds }, status: 'ACTIVE' };
    const candidateWhere: Prisma.TestDesignCandidateWhereInput = { testDesignId: request.testDesignId!, sourceDefinition: { moduleId: { in: moduleIds } } };
    const exceptionWhere: Prisma.TestDesignCandidateWhereInput = {
      ...candidateWhere,
      OR: [
        { action: 'CREATE', sourceDefinitionId: null, decisionNote: null },
        { resolution: 'PENDING', decisionNote: null },
        { action: 'EXCLUDE', decisionNote: null },
      ],
    };
    const [totalCount, includedCount, aiRecommendedCount, exceptionCount] = await Promise.all([
      prisma.testCaseDefinition.count({ where: definitionWhere }),
      prisma.testDesignCandidate.count({ where: { ...candidateWhere, action: { not: 'EXCLUDE' }, resolution: { not: 'REJECTED' } } }),
      prisma.testDesignCandidate.count({ where: { ...candidateWhere, action: { not: 'EXCLUDE' } } }),
      prisma.testDesignCandidate.count({ where: exceptionWhere }),
    ]);
    const status = totalCount === 0 || includedCount === 0 ? 'NONE' : includedCount >= totalCount ? 'ALL' : 'PARTIAL';
    return { moduleId: module.id, libraryId: module.libraryId, moduleName: module.name, totalCount, includedCount, aiRecommendedCount, exceptionCount, status };
  }));
}
