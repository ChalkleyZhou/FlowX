import { Prisma } from '@prisma/client';

const PREFIX_BY_KIND: Record<string, string> = {
  REQUIREMENT: 'REQ',
  ISSUE: 'ISSUE',
  BUG: 'BUG',
};

type SequenceClient = Pick<Prisma.TransactionClient, 'workItemSequence'>;

/** 在当前事务内为工作项分配项目内、按类型递增的可读编号。 */
export async function reserveWorkItemDisplayCode(
  tx: SequenceClient,
  projectId: string,
  kind: string,
): Promise<string> {
  const prefix = PREFIX_BY_KIND[kind] ?? kind;
  const sequence = await tx.workItemSequence.upsert({
    where: { projectId_kind: { projectId, kind } },
    create: { projectId, kind, nextValue: 1 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `${prefix}-${String(sequence.nextValue).padStart(3, '0')}`;
}

export function workItemKindPrefix(kind: string): string {
  return PREFIX_BY_KIND[kind] ?? kind;
}
