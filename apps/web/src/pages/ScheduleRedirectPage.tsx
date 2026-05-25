import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { defaultScheduleRange } from '../utils/schedule-filters';

function buildScheduleSearch(
  params: Record<string, string | null | undefined>,
): string {
  const next = new URLSearchParams();
  const range = defaultScheduleRange();
  next.set('from', params.from ?? range.from);
  next.set('to', params.to ?? range.to);
  if (params.projectId) {
    next.set('projectId', params.projectId);
  }
  if (params.requirementId) {
    next.set('requirementId', params.requirementId);
  }
  if (params.onlyMe) {
    next.set('onlyMe', '1');
  }
  if (params.role) {
    next.set('role', params.role);
  }
  return next.toString();
}

export function ScheduleMembersRedirect() {
  const range = defaultScheduleRange();
  return (
    <Navigate
      to={`/schedule?${buildScheduleSearch({ onlyMe: '1', from: range.from, to: range.to })}`}
      replace
    />
  );
}

export function ProjectScheduleRedirect() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <Navigate
      to={`/schedule?${buildScheduleSearch({
        projectId: projectId ?? null,
        from: searchParams.get('from'),
        to: searchParams.get('to'),
      })}`}
      replace
    />
  );
}
