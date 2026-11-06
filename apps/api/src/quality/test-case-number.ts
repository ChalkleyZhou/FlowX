import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// 必须与用例写入处于同一事务；先写计数器，让并发创建和导入串行分配编号。
export async function assignTestCaseNumbers(
  tx: Prisma.TransactionClient,
  libraryId: string,
  requested: (string | undefined)[],
): Promise<string[]> {
  const library = await tx.testCaseLibrary.update({
    where: { id: libraryId },
    data: { nextCaseNumber: { increment: 0 } },
    select: { nextCaseNumber: true },
  });
  const existing = await tx.testCaseDefinition.findMany({
    where: { libraryId, externalId: { not: null } },
    select: { externalId: true, status: true },
  });
  const activeIds = new Set(existing.filter(item => item.status === 'ACTIVE').map(item => item.externalId));
  const reserved = new Set(requested.filter((id): id is string => Boolean(id)));
  for (const id of reserved) {
    if (activeIds.has(id)) throw new BadRequestException(`用例编号“${id}”已存在于目标用例库。`);
  }

  let next = library.nextCaseNumber;
  // 保留历史、归档及本批导入的流水号，避免升级后的首个编号与它们冲突。
  for (const id of [...existing.map(item => item.externalId), ...reserved]) {
    if (!id || !/^TC-\d{6,}$/.test(id)) continue;
    const number = Number(id.slice(3));
    if (Number.isSafeInteger(number) && number < 2_147_483_647) next = Math.max(next, number + 1);
  }
  const assigned = requested.map(id => {
    if (id) return id;
    if (next >= 2_147_483_647) throw new BadRequestException('用例编号已超出可分配范围。');
    return `TC-${String(next++).padStart(6, '0')}`;
  });
  if (next !== library.nextCaseNumber) {
    await tx.testCaseLibrary.update({ where: { id: libraryId }, data: { nextCaseNumber: next } });
  }
  return assigned;
}
