import { BadRequestException } from '@nestjs/common';
import {
  EXECUTION_SESSION_STATUSES,
  EXECUTION_SESSION_TERMINAL_STATUSES,
  canTransitionExecutionSession,
  type ExecutionSessionStatus,
} from '@flowx-ai/protocol';

export const ACTIVE_EXECUTION_SESSION_STATUSES = EXECUTION_SESSION_STATUSES.filter(
  (status) =>
    !EXECUTION_SESSION_TERMINAL_STATUSES.includes(
      status as (typeof EXECUTION_SESSION_TERMINAL_STATUSES)[number],
    ),
);

export function assertExecutionSessionTransition(
  from: ExecutionSessionStatus,
  to: ExecutionSessionStatus,
): void {
  if (from === to) {
    return;
  }
  if (!canTransitionExecutionSession(from, to)) {
    throw new BadRequestException({
      code: 'EXECUTION_SESSION_TERMINAL',
      message: `Illegal execution session transition: ${from} -> ${to}`,
    });
  }
}
