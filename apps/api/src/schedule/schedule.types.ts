export type GanttView = 'requirement' | 'member';
export type GanttScope = 'project' | 'organization';

export interface GanttLane {
  id: string;
  kind: 'requirement' | 'member';
  parentLaneId?: string;
  label: string;
  meta: Record<string, string | undefined>;
}

export interface GanttBar {
  id: string;
  laneId: string;
  label: string;
  start: string;
  end: string;
  estimatedDays: number;
  estimatedHours: number;
  color?: string;
  meta: {
    projectId: string;
    requirementId: string;
    userId: string;
    role: string;
  };
}

export interface GanttPayload {
  view: GanttView;
  range: { from: string; to: string };
  lanes: GanttLane[];
  bars: GanttBar[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface GetScheduleGanttQuery {
  view: GanttView;
  scope?: GanttScope;
  projectId?: string;
  organizationId?: string;
  from: string;
  to: string;
  userId?: string;
  requirementId?: string;
  role?: string;
  q?: string;
  page?: string | number;
  pageSize?: string | number;
}
