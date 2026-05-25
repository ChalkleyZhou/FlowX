import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { ScheduleAssignmentDialog } from '../components/ScheduleAssignmentDialog';
import { ScheduleGantt } from '../components/ScheduleGantt';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { Project, Requirement } from '../types';
import {
  defaultScheduleRange,
  parseScheduleRange,
  ALL_PROJECTS,
  ALL_REQUIREMENTS,
  ALL_ROLES,
  ASSIGNMENT_ROLE_OPTIONS,
} from '../utils/schedule-filters';
import { monthRange, shiftMonth } from '../utils/gantt-range';
import { cn } from '../lib/utils';

export function ScheduleHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [ganttRefreshToken, setGanttRefreshToken] = useState(0);

  const projectId = searchParams.get('projectId') ?? '';
  const requirementId = searchParams.get('requirementId') ?? '';
  const role = searchParams.get('role') ?? '';
  const onlyMe = searchParams.get('onlyMe') === '1' || searchParams.get('onlyMe') === 'true';
  const { from, to } = parseScheduleRange(searchParams);

  useEffect(() => {
    if (!searchParams.get('from') || !searchParams.get('to')) {
      const fallback = defaultScheduleRange();
      const next = new URLSearchParams(searchParams);
      next.set('from', fallback.from);
      next.set('to', fallback.to);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    void (async () => {
      setMetaLoading(true);
      try {
        const [projectList, requirementList] = await Promise.all([
          api.getProjects(),
          api.getRequirements(),
        ]);
        setProjects(projectList);
        setRequirements(requirementList);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载筛选数据失败');
      } finally {
        setMetaLoading(false);
      }
    })();
  }, []);

  const requirementOptions = useMemo(() => {
    if (!projectId) {
      return [];
    }
    return requirements.filter((r) => r.project.id === projectId);
  }, [requirements, projectId]);

  const requirementFilterReady = Boolean(projectId) && requirementOptions.length > 0;

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    if (!next.get('from') || !next.get('to')) {
      const fallback = defaultScheduleRange();
      next.set('from', fallback.from);
      next.set('to', fallback.to);
    }
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (!requirements.length) {
      return;
    }
    if (requirementId && !projectId) {
      updateParams({ requirementId: null });
      return;
    }
    if (requirementId && projectId) {
      const match = requirements.find((r) => r.id === requirementId);
      if (match?.project.id !== projectId) {
        updateParams({ requirementId: null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reconcile URL when data/filters change
  }, [requirements, projectId, requirementId]);

  function handleProjectChange(value: string) {
    const nextProjectId = value === ALL_PROJECTS ? '' : value;
    updateParams({
      projectId: nextProjectId || null,
      requirementId: null,
    });
  }

  function handleRequirementChange(value: string) {
    updateParams({
      requirementId: value === ALL_REQUIREMENTS ? null : value,
    });
  }

  function handleRoleChange(value: string) {
    updateParams({ role: value === ALL_ROLES ? null : value });
  }

  function handleOnlyMeChange(checked: boolean) {
    updateParams({ onlyMe: checked ? '1' : null });
  }

  function applyMonthPreset(deltaMonths: number) {
    const anchor = deltaMonths === 0 ? new Date() : new Date(`${from}T00:00:00.000Z`);
    if (deltaMonths !== 0) {
      anchor.setUTCMonth(anchor.getUTCMonth() + deltaMonths);
    }
    const next = monthRange(anchor);
    updateParams({ from: next.from, to: next.to });
  }

  const ganttQuery = useMemo(
    () => ({
      scope: 'organization' as const,
      projectId: projectId || undefined,
      requirementId: requirementId || undefined,
      role: role || undefined,
      onlyMe: onlyMe || undefined,
      from,
      to,
    }),
    [projectId, requirementId, role, onlyMe, from, to],
  );

  return (
    <>
      <PageHeader
        eyebrow="Schedule"
        title="排期甘特"
        description="每行一名成员，每列一天；条形为在该时间段内的排期任务。筛选时需先选项目，再选该项目下的需求。"
        actions={(
          <>
            <Button type="button" onClick={() => setCreateDialogOpen(true)}>
              新建排期
            </Button>
            <Button variant="outline" asChild>
              <Link to="/requirements">需求列表</Link>
            </Button>
          </>
        )}
      />

      <Card className="mb-4 rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <FilterField label="项目">
              {metaLoading ? (
                <Spinner className="h-5 w-5" />
              ) : (
                <Select value={projectId || ALL_PROJECTS} onValueChange={handleProjectChange}>
                  <SelectTrigger className="w-[220px]" aria-label="筛选项目">
                    <SelectValue placeholder="全部项目" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PROJECTS}>全部项目</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FilterField>

            <FilterField label="需求">
              <Select
                value={projectId ? requirementId || ALL_REQUIREMENTS : undefined}
                onValueChange={handleRequirementChange}
                disabled={!projectId || metaLoading}
              >
                <SelectTrigger className="w-[260px]" aria-label="筛选需求">
                  <SelectValue
                    placeholder={
                      !projectId
                        ? '请先选择项目'
                        : requirementOptions.length === 0
                          ? '该项目下暂无需求'
                          : '全部需求'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_REQUIREMENTS}>全部需求</SelectItem>
                  {requirementFilterReady
                    ? requirementOptions.map((req) => (
                        <SelectItem key={req.id} value={req.id}>
                          {req.title}
                        </SelectItem>
                      ))
                    : null}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="角色">
              <Select value={role || ALL_ROLES} onValueChange={handleRoleChange}>
                <SelectTrigger className="w-[140px]" aria-label="筛选角色">
                  <SelectValue placeholder="全部角色" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ROLES}>全部角色</SelectItem>
                  {ASSIGNMENT_ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={onlyMe}
                onChange={(e) => handleOnlyMeChange(e.target.checked)}
                aria-label="只显示自己"
              />
              只显示自己
              {session?.user?.displayName ? (
                <span className="text-muted-foreground">（{session.user.displayName}）</span>
              ) : null}
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <FilterField label="开始日期">
              <Input
                type="date"
                className="w-[160px]"
                value={from}
                onChange={(e) => updateParams({ from: e.target.value || null })}
                aria-label="开始日期"
              />
            </FilterField>
            <FilterField label="结束日期">
              <Input
                type="date"
                className="w-[160px]"
                value={to}
                min={from}
                onChange={(e) => updateParams({ to: e.target.value || null })}
                aria-label="结束日期"
              />
            </FilterField>
            <div className="flex flex-wrap gap-2 pb-0.5">
              <Button type="button" variant="outline" size="sm" onClick={() => applyMonthPreset(-1)}>
                上一月
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyMonthPreset(0)}>
                本月
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => applyMonthPreset(1)}>
                下一月
              </Button>
            </div>
            {selectedProject ? (
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
                <Link to={`/projects/${selectedProject.id}`}>项目详情</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardContent className="p-5">
          <ScheduleGantt query={ganttQuery} refreshToken={ganttRefreshToken} />
        </CardContent>
      </Card>

      <ScheduleAssignmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialProjectId={projectId}
        initialRequirementId={requirementId}
        onSaved={() => setGanttRefreshToken((n) => n + 1)}
      />
    </>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5')}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
