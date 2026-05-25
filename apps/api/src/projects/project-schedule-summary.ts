import { countBusinessDays, formatCalendarDate } from '../common/business-days';

type AssignmentLike = {
  plannedStartDate: Date;
  plannedEndDate: Date;
};

export function summarizeRequirementSchedule(assignments: AssignmentLike[]) {
  if (assignments.length === 0) {
    return {
      assignmentCount: 0,
      scheduleStart: null,
      scheduleEnd: null,
      totalEstimatedDays: 0,
    };
  }

  const starts = assignments.map((item) => formatCalendarDate(item.plannedStartDate)).sort();
  const ends = assignments.map((item) => formatCalendarDate(item.plannedEndDate)).sort();
  const scheduleStart = starts[0] ?? null;
  const scheduleEnd = ends.at(-1) ?? null;
  const totalEstimatedDays = assignments.reduce(
    (sum, item) =>
      sum +
      countBusinessDays(
        formatCalendarDate(item.plannedStartDate),
        formatCalendarDate(item.plannedEndDate),
      ),
    0,
  );

  return {
    assignmentCount: assignments.length,
    scheduleStart,
    scheduleEnd,
    totalEstimatedDays,
  };
}
