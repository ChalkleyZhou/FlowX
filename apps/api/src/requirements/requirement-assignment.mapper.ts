import type { Prisma } from '@prisma/client';
import {
  countBusinessDays,
  estimateHoursFromRange,
  formatCalendarDate,
} from '../common/business-days';

export type RequirementAssignmentRow = Prisma.RequirementAssignmentGetPayload<{
  include: { user: true };
}>;

export function toRequirementAssignmentResponse(row: RequirementAssignmentRow) {
  const start = formatCalendarDate(row.plannedStartDate);
  const end = formatCalendarDate(row.plannedEndDate);
  return {
    id: row.id,
    requirementId: row.requirementId,
    userId: row.userId,
    role: row.role,
    plannedStartDate: start,
    plannedEndDate: end,
    sortOrder: row.sortOrder,
    colorToken: row.colorToken,
    note: row.note,
    estimatedDays: countBusinessDays(start, end),
    estimatedHours: estimateHoursFromRange(start, end),
    user: {
      id: row.user.id,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
    },
  };
}
