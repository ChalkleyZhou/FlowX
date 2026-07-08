import type { PrismaService } from '../prisma/prisma.service';
import type { AiInvocationRecipient } from '../ai/ai-invocation-context.service';

export type BriefingAuthSession = {
  user?: {
    id?: string;
    displayName?: string;
  } | null;
  organization?: {
    id?: string | null;
    name?: string | null;
    providerOrganizationId?: string | null;
  } | null;
};

export function toAiInvocationRecipient(session?: BriefingAuthSession): AiInvocationRecipient | null {
  const organization = session?.organization;
  const organizationId = organization?.id?.trim() || null;
  const userId = session?.user?.id?.trim();
  const displayName = session?.user?.displayName?.trim();

  if (userId && displayName) {
    return {
      flowxUserId: userId,
      flowxOrganizationId: organizationId,
      displayName,
      providerOrganizationId: organization?.providerOrganizationId ?? null,
      organizationName: organization?.name ?? null,
    };
  }

  if (organizationId) {
    return {
      flowxUserId: 'scheduler',
      flowxOrganizationId: organizationId,
      displayName: 'FlowX Scheduler',
      providerOrganizationId: organization?.providerOrganizationId ?? null,
      organizationName: organization?.name ?? null,
    };
  }

  return null;
}

export async function resolveProjectOrganizationId(
  prisma: PrismaService,
  projectId: string,
): Promise<string | null> {
  const deliveryTarget = await prisma.deliveryTarget.findFirst({
    where: {
      projectId,
      isActive: true,
      organizationId: { not: null },
    },
    select: { organizationId: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (deliveryTarget?.organizationId) {
    return deliveryTarget.organizationId;
  }

  const orgCredentials = await prisma.organizationAiCredential.findMany({
    select: { organizationId: true },
    distinct: ['organizationId'],
  });
  const uniqueOrgIds = [...new Set(orgCredentials.map((record) => record.organizationId))];
  if (uniqueOrgIds.length === 1) {
    return uniqueOrgIds[0] ?? null;
  }

  return null;
}

export async function buildSchedulerAuthSession(
  prisma: PrismaService,
  organizationId: string,
): Promise<BriefingAuthSession> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      providerOrganizationId: true,
    },
  });

  if (!organization) {
    return { organization: { id: organizationId } };
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      providerOrganizationId: organization.providerOrganizationId,
    },
  };
}
