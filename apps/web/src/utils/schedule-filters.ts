import { monthRange } from './gantt-range';

export const ALL_PROJECTS = '__all__';
export const ALL_REQUIREMENTS = '__all__';
export const ALL_ROLES = '__all__';

export const ASSIGNMENT_ROLE_OPTIONS = [
  { value: 'PM', label: '产品' },
  { value: 'FRONTEND', label: '前端' },
  { value: 'BACKEND', label: '后端' },
  { value: 'FULLSTACK', label: '全栈' },
  { value: 'QA', label: '测试' },
  { value: 'DESIGN', label: '设计' },
  { value: 'OTHER', label: '其他' },
] as const;

export function defaultScheduleRange() {
  return monthRange();
}

export function parseScheduleRange(searchParams: URLSearchParams) {
  const fallback = defaultScheduleRange();
  const from = searchParams.get('from') ?? fallback.from;
  const to = searchParams.get('to') ?? fallback.to;
  return { from, to };
}
