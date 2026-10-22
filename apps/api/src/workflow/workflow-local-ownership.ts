import { ConflictException, ForbiddenException } from '@nestjs/common';

export type LocalSessionScope = { organizationId?: string | null; userId?: string | null };

/** 领取归属独立于组织可见性；管理员也不能冒充本地执行人回传。 */
export function assertLocalSessionOwner(
  session: { id: string; organizationId?: string | null; claimedByUserId?: string | null },
  scope: LocalSessionScope,
  action: 'claim' | 'complete' = 'complete',
) {
  if (session.organizationId && session.organizationId !== scope.organizationId?.trim()) {
    throw new ForbiddenException('该本地任务属于其他组织。');
  }
  if (!session.claimedByUserId) {
    throw new ConflictException({
      code: 'LOCAL_TASK_OWNER_UNRECORDED',
      message: '历史会话未记录执行人，请由组织管理员确认原设备任务已停止后重新交接。',
    });
  }
  if (session.claimedByUserId !== scope.userId?.trim()) {
    const payload = {
      code: 'LOCAL_TASK_OWNED_BY_ANOTHER_USER',
      message: action === 'claim'
        ? '当前阶段已由其他执行人领取，请查看工作流进展，等待回传或重新交接。'
        : '仅原领取执行人可以回传本地任务结果。',
      executionSessionId: session.id,
    };
    if (action === 'claim') throw new ConflictException(payload);
    throw new ForbiddenException(payload);
  }
}
