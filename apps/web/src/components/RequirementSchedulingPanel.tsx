import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { SectionHeading } from './ui/section-heading';
import { Spinner } from './ui/spinner';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';
import type { OrganizationMember, Requirement, RequirementAssignment } from '../types';
import { addLocalCalendarDays, displayEstimatedDays, localTodayIso } from '../utils/business-days';
import { formatAssignmentRole, formatPlanningStatus, formatPriority } from '../utils/label-utils';

const ROLE_OPTIONS = ['PM', 'FRONTEND', 'BACKEND', 'FULLSTACK', 'QA', 'DESIGN', 'OTHER'] as const;
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const PLANNING_OPTIONS = ['UNSCHEDULED', 'SCHEDULED', 'IN_PROGRESS', 'DONE'] as const;

function defaultScheduleRange() {
  const start = localTodayIso();
  return {
    plannedStartDate: start,
    plannedEndDate: addLocalCalendarDays(start, 4),
  };
}

interface RequirementSchedulingPanelProps {
  requirement: Requirement;
  onChanged: () => Promise<void> | void;
}

export function RequirementSchedulingPanel({ requirement, onChanged }: RequirementSchedulingPanelProps) {
  const toast = useToast();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [assignments, setAssignments] = useState<RequirementAssignment[]>(requirement.assignments ?? []);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementAssignment | null>(null);
  const [priority, setPriority] = useState(requirement.priority ?? 'MEDIUM');
  const [planningStatus, setPlanningStatus] = useState(requirement.planningStatus ?? 'UNSCHEDULED');
  const [draft, setDraft] = useState({
    userId: '',
    role: 'FRONTEND',
    ...defaultScheduleRange(),
    note: '',
  });

  const totalEstimatedDays = useMemo(
    () => assignments.reduce((sum, item) => sum + displayEstimatedDays(item), 0),
    [assignments],
  );

  async function refreshAssignments() {
    setLoading(true);
    try {
      setAssignments(await api.getRequirementAssignments(requirement.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载排期失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setAssignments(requirement.assignments ?? []);
    setPriority(requirement.priority ?? 'MEDIUM');
    setPlanningStatus(requirement.planningStatus ?? 'UNSCHEDULED');
  }, [requirement]);

  useEffect(() => {
    void (async () => {
      try {
        setMembers(await api.getOrganizationMembers());
      } catch {
        setMembers([]);
      }
    })();
  }, []);

  function openCreateDialog() {
    setEditing(null);
    setDraft({
      userId: members[0]?.id ?? '',
      role: 'FRONTEND',
      ...defaultScheduleRange(),
      note: '',
    });
    setDialogOpen(true);
  }

  function openEditDialog(assignment: RequirementAssignment) {
    setEditing(assignment);
    setDraft({
      userId: assignment.userId,
      role: assignment.role,
      plannedStartDate: assignment.plannedStartDate,
      plannedEndDate: assignment.plannedEndDate,
      note: assignment.note ?? '',
    });
    setDialogOpen(true);
  }

  async function savePlanningMeta(nextPriority = priority, nextPlanningStatus = planningStatus) {
    await api.updateRequirement(requirement.id, {
      priority: nextPriority,
      planningStatus: nextPlanningStatus,
    });
    await onChanged();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.userId) {
      toast.error('请选择排期成员');
      return;
    }

    try {
      if (editing) {
        await api.updateRequirementAssignment(requirement.id, editing.id, draft);
      } else {
        await api.createRequirementAssignment(requirement.id, draft);
      }
      setDialogOpen(false);
      await refreshAssignments();
      await onChanged();
      toast.success(editing ? '排期已更新' : '排期已添加');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存排期失败');
    }
  }

  async function handleDelete(assignmentId: string) {
    try {
      await api.deleteRequirementAssignment(requirement.id, assignmentId);
      await refreshAssignments();
      await onChanged();
      toast.success('排期已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除排期失败');
    }
  }

  return (
    <Card id="scheduling" className="rounded-2xl border border-border bg-card shadow-sm scroll-mt-6">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            eyebrow="Scheduling"
            title="人员排期"
            description="按成员配置计划周期，工时将按工作日从起止日期自动推算。"
          />
          <Button onClick={openCreateDialog}>添加排期</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5 pt-0">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">优先级</label>
            <Select
              value={priority}
              onValueChange={(value) => {
                setPriority(value);
                void savePlanningMeta(value, planningStatus);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {formatPriority(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">排期状态</label>
            <Select
              value={planningStatus}
              onValueChange={(value) => {
                setPlanningStatus(value);
                void savePlanningMeta(priority, value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANNING_OPTIONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {formatPlanningStatus(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-sm text-muted-foreground">
              合计预估 <span className="font-semibold text-foreground">{totalEstimatedDays}</span> 人天
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-24 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : assignments.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">成员</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">计划周期</th>
                  <th className="px-4 py-3 font-medium">人天</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="border-t border-border">
                    <td className="px-4 py-3 text-foreground">{assignment.user?.displayName ?? assignment.userId}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{formatAssignmentRole(assignment.role)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {assignment.plannedStartDate} ~ {assignment.plannedEndDate}
                    </td>
                    <td className="px-4 py-3 text-foreground">{displayEstimatedDays(assignment)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(assignment)}>
                          编辑
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void handleDelete(assignment.id)}>
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">还没有配置人员排期，添加后会自动标记为已排期。</p>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑排期' : '添加排期'}</DialogTitle>
            <DialogDescription>为这条需求指定成员、角色和计划起止日期。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">成员</label>
              <Select value={draft.userId || undefined} onValueChange={(value) => setDraft((c) => ({ ...c, userId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择成员" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">角色</label>
              <Select value={draft.role} onValueChange={(value) => setDraft((c) => ({ ...c, role: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((role) => (
                    <SelectItem key={role} value={role}>
                      {formatAssignmentRole(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">开始日期</label>
                <Input
                  type="date"
                  value={draft.plannedStartDate}
                  onChange={(event) => setDraft((c) => ({ ...c, plannedStartDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">结束日期</label>
                <Input
                  type="date"
                  value={draft.plannedEndDate}
                  onChange={(event) => setDraft((c) => ({ ...c, plannedEndDate: event.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">备注</label>
              <Textarea
                rows={3}
                value={draft.note}
                onChange={(event) => setDraft((c) => ({ ...c, note: event.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="submit">{editing ? '保存' : '添加'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
