import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ScheduleAssignmentDialog } from './ScheduleAssignmentDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { SectionHeading } from './ui/section-heading';
import { Spinner } from './ui/spinner';
import { useToast } from './ui/toast';
import type { Requirement, RequirementAssignment } from '../types';
import { displayEstimatedDays } from '../utils/business-days';
import { formatAssignmentRole, formatPlanningStatus, formatPriority } from '../utils/label-utils';

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const PLANNING_OPTIONS = ['UNSCHEDULED', 'SCHEDULED', 'IN_PROGRESS', 'DONE'] as const;

interface RequirementSchedulingPanelProps {
  requirement: Requirement;
  onChanged: () => Promise<void> | void;
}

export function RequirementSchedulingPanel({ requirement, onChanged }: RequirementSchedulingPanelProps) {
  const toast = useToast();
  const [assignments, setAssignments] = useState<RequirementAssignment[]>(requirement.assignments ?? []);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementAssignment | null>(null);
  const [priority, setPriority] = useState(requirement.priority ?? 'MEDIUM');
  const [planningStatus, setPlanningStatus] = useState(requirement.planningStatus ?? 'UNSCHEDULED');

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

  function openCreateDialog() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEditDialog(assignment: RequirementAssignment) {
    setEditing(assignment);
    setDialogOpen(true);
  }

  async function savePlanningMeta(nextPriority = priority, nextPlanningStatus = planningStatus) {
    await api.updateRequirement(requirement.id, {
      priority: nextPriority,
      planningStatus: nextPlanningStatus,
    });
    await onChanged();
  }

  async function handleAssignmentSaved() {
    await refreshAssignments();
    await onChanged();
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
    <Card id="scheduling" className="rounded-md border border-border bg-card scroll-mt-6">
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
          <div className="overflow-x-auto rounded-md border border-border">
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

      <ScheduleAssignmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        fixedRequirementId={requirement.id}
        fixedRequirementTitle={requirement.title}
        onSaved={handleAssignmentSaved}
      />
    </Card>
  );
}
