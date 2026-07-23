import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { GanttBar, GanttLane, GanttPayload } from '../types';
import { ganttBarColorClass } from '../utils/gantt-bar-styles';
import {
  barGridSpan,
  clipRangeToWindow,
  dayHeaderLabel,
  enumerateDays,
  formatRangeLabel,
  isWeekendUtc,
} from '../utils/gantt-range';
import { formatAssignmentRole } from '../utils/label-utils';
import { cn } from '../lib/utils';
import { Spinner } from './ui/spinner';

const LANE_LABEL_WIDTH = '11rem';
const DAY_COL_MIN = '2.35rem';
const ROW_HEIGHT = 44;

export interface ScheduleGanttQuery {
  scope?: 'project' | 'organization';
  projectId?: string;
  requirementId?: string;
  role?: string;
  userId?: string;
  onlyMe?: boolean;
  from: string;
  to: string;
}

interface ScheduleGanttProps {
  query: ScheduleGanttQuery;
  /** 变更后递增以重新拉取甘特数据 */
  refreshToken?: number;
}

function barsByLane(bars: GanttBar[]): Map<string, GanttBar[]> {
  const map = new Map<string, GanttBar[]>();
  for (const bar of bars) {
    const list = map.get(bar.laneId) ?? [];
    list.push(bar);
    map.set(bar.laneId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start));
  }
  return map;
}

function barTooltip(bar: GanttBar): string {
  const role =
    bar.meta.role === 'AGGREGATE' ? '整体' : formatAssignmentRole(bar.meta.role);
  return `${bar.label}\n${bar.start} ~ ${bar.end}\n${bar.estimatedDays} 人天 / ${bar.estimatedHours}h · ${role}`;
}

export function ScheduleGantt({ query, refreshToken = 0 }: ScheduleGanttProps) {
  const [payload, setPayload] = useState<GanttPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const range = useMemo(() => ({ from: query.from, to: query.to }), [query.from, query.to]);
  const scope = query.scope ?? (query.projectId ? 'project' : 'organization');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        setPayload(
          await api.getScheduleGantt({
            view: 'member',
            scope,
            from: query.from,
            to: query.to,
            ...(query.projectId ? { projectId: query.projectId } : {}),
            ...(query.requirementId ? { requirementId: query.requirementId } : {}),
            ...(query.role ? { role: query.role } : {}),
            ...(query.onlyMe ? { onlyMe: true } : query.userId ? { userId: query.userId } : {}),
          }),
        );
      } catch (error) {
        setPayload(null);
        setLoadError(error instanceof Error ? error.message : '加载甘特数据失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [
    scope,
    query.projectId,
    query.requirementId,
    query.role,
    query.userId,
    query.onlyMe,
    query.from,
    query.to,
    refreshToken,
  ]);

  const days = useMemo(() => enumerateDays(range.from, range.to), [range.from, range.to]);
  const dayCount = days.length;
  const displayBars = useMemo(
    () => (payload?.bars ?? []).filter((bar) => !bar.id.endsWith(':aggregate')),
    [payload?.bars],
  );

  const lanes: GanttLane[] = useMemo(() => {
    const all = payload?.lanes ?? [];
    const laneIds = new Set(displayBars.map((b) => b.laneId));
    return all.filter((lane) => laneIds.has(lane.id));
  }, [payload?.lanes, displayBars]);

  const laneBarMap = useMemo(() => barsByLane(displayBars), [displayBars]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }

  if (!payload || lanes.length === 0) {
    const filterHints: string[] = [];
    if (query.onlyMe) {
      filterHints.push('已勾选「只显示自己」');
    }
    if (query.projectId) {
      filterHints.push('已筛选项目');
    }
    if (query.requirementId) {
      filterHints.push('已筛选需求');
    }
    if (query.role) {
      filterHints.push('已筛选角色');
    }
    const filterNote =
      filterHints.length > 0 ? `（${filterHints.join('、')}，可尝试放宽筛选）` : '';
    return (
      <p className="text-sm text-muted-foreground">
        {formatRangeLabel(range.from, range.to)} 当前时间范围内没有排期条{filterNote}。
        请确认计划日期落在此区间，或在需求详情「人员排期」中配置成员与起止日。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        纵轴为自然日（{range.from} ~ {range.to}），横轴每行一名成员；条形为排期任务，人天按工作日计。
      </p>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <div
          className="inline-grid min-w-full"
          style={{
            gridTemplateColumns: `${LANE_LABEL_WIDTH} repeat(${dayCount}, minmax(${DAY_COL_MIN}, 1fr))`,
          }}
        >
          <div className="sticky left-0 z-20 border-b border-r border-border bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            成员
          </div>
          {days.map((day) => {
            const weekend = isWeekendUtc(day);
            return (
              <div
                key={day}
                className={cn(
                  'border-b border-border px-0.5 py-2 text-center text-[10px] leading-tight text-muted-foreground',
                  weekend && 'bg-muted/50',
                )}
                title={day}
              >
                <span className={cn('block', weekend && 'text-muted-foreground/70')}>
                  {dayHeaderLabel(day)}
                </span>
              </div>
            );
          })}

          {lanes.map((lane) => {
            const bars = laneBarMap.get(lane.id) ?? [];
            const stackCount = Math.max(1, bars.length);

            return (
              <div key={lane.id} className="contents">
                <div
                  className="sticky left-0 z-10 flex items-center border-b border-r border-border bg-card px-3 py-2"
                  style={{ minHeight: ROW_HEIGHT * stackCount }}
                >
                  <span className="truncate text-sm font-medium text-foreground" title={lane.label}>
                    {lane.label}
                  </span>
                </div>

                <div
                  className="relative border-b border-border"
                  style={{
                    gridColumn: `2 / span ${dayCount}`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${dayCount}, minmax(${DAY_COL_MIN}, 1fr))`,
                    minHeight: ROW_HEIGHT * stackCount,
                  }}
                >
                  {days.map((day) => (
                    <div
                      key={`${lane.id}-${day}`}
                      className={cn(
                        'border-r border-border/60 last:border-r-0',
                        isWeekendUtc(day) && 'bg-muted/30',
                      )}
                    />
                  ))}

                  {bars.map((bar, index) => {
                    const clipped = clipRangeToWindow(bar.start, bar.end, range);
                    const { startCol, endCol } = barGridSpan(clipped.start, clipped.end, range);
                    const reqLink = bar.meta.requirementId
                      ? `/requirements/${bar.meta.requirementId}#scheduling`
                      : null;
                    return (
                      <div
                        key={bar.id}
                        className={cn(
                          'pointer-events-auto z-[1] mx-0.5 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-medium',
                          ganttBarColorClass(bar.color),
                          reqLink && 'hover:brightness-95',
                        )}
                        style={{
                          gridColumn: `${startCol} / ${endCol}`,
                          gridRow: 1,
                          alignSelf: 'start',
                          marginTop: 4 + index * (ROW_HEIGHT - 8),
                          height: ROW_HEIGHT - 12,
                        }}
                        title={barTooltip(bar)}
                      >
                        {reqLink ? (
                          <Link
                            to={reqLink}
                            className="truncate text-inherit no-underline hover:underline"
                          >
                            {bar.label}
                          </Link>
                        ) : (
                          <span className="truncate">{bar.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
