import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';
import { useToast } from './ui/toast';
import type { OrganizationMember, Project, Requirement, RequirementAssignment } from '../types';
import { addLocalCalendarDays, localTodayIso } from '../utils/business-days';
import { ASSIGNMENT_ROLE_OPTIONS } from '../utils/schedule-filters';

export interface ScheduleAssignmentDraft {
  userId: string;
  role: string;
  plannedStartDate: string;
  plannedEndDate: string;
  note: string;
}

export function defaultScheduleAssignmentDraft(
  defaultUserId = '',
): ScheduleAssignmentDraft {
  const start = localTodayIso();
  return {
    userId: defaultUserId,
    role: 'FRONTEND',
    plannedStartDate: start,
    plannedEndDate: addLocalCalendarDays(start, 4),
    note: '',
  };
}

export interface ScheduleAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: RequirementAssignment | null;
  /** 固定需求时隐藏项目/需求选择（需求详情页） */
  fixedRequirementId?: string;
  fixedRequirementTitle?: string;
  initialProjectId?: string;
  initialRequirementId?: string;
  onSaved: () => void | Promise<void>;
}

export function ScheduleAssignmentDialog({
  open,
  onOpenChange,
  editing = null,
  fixedRequirementId,
  fixedRequirementTitle,
  initialProjectId = '',
  initialRequirementId = '',
  onSaved,
}: ScheduleAssignmentDialogProps) {
  const toast = useToast();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [projectId, setProjectId] = useState(() => initialProjectId);
  const [requirementId, setRequirementId] = useState(
    () => fixedRequirementId ?? initialRequirementId,
  );
  const [draft, setDraft] = useState<ScheduleAssignmentDraft>(() =>
    defaultScheduleAssignmentDraft(),
  );

  const pickerEnabled = !fixedRequirementId;
  const resolvedRequirementId = fixedRequirementId ?? requirementId;

  const requirementOptions = useMemo(() => {
    if (!pickerEnabled || !projectId) {
      return [];
    }
    return requirements.filter((r) => r.project.id === projectId);
  }, [pickerEnabled, projectId, requirements]);

  const requirementPickerReady = Boolean(projectId) && requirementOptions.length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editing) {
      setDraft({
        userId: editing.userId,
        role: editing.role,
        plannedStartDate: editing.plannedStartDate,
        plannedEndDate: editing.plannedEndDate,
        note: editing.note ?? '',
      });
      return;
    }

    setProjectId(initialProjectId);
    setRequirementId(fixedRequirementId ?? initialRequirementId);
    setDraft(defaultScheduleAssignmentDraft());
  }, [
    open,
    editing?.id,
    editing?.userId,
    editing?.role,
    editing?.plannedStartDate,
    editing?.plannedEndDate,
    editing?.note,
    fixedRequirementId,
    initialProjectId,
    initialRequirementId,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setMetaLoading(true);
      try {
        const memberList = await api.getOrganizationMembers();
        if (cancelled) {
          return;
        }
        setMembers(memberList);

        if (!pickerEnabled) {
          if (!editing) {
            setDraft(defaultScheduleAssignmentDraft(memberList[0]?.id ?? ''));
          }
          return;
        }

        const [projectList, requirementList] = await Promise.all([
          api.getProjects(),
          api.getRequirements(),
        ]);
        if (cancelled) {
          return;
        }
        setProjects(projectList);
        setRequirements(requirementList);

        if (editing) {
          return;
        }

        const nextProjectId = initialProjectId || '';
        let nextRequirementId = '';
        if (nextProjectId) {
          const filtered = requirementList.filter((r) => r.project.id === nextProjectId);
          if (
            initialRequirementId &&
            filtered.some((r) => r.id === initialRequirementId)
          ) {
            nextRequirementId = initialRequirementId;
          }
        }
        setProjectId(nextProjectId);
        setRequirementId(nextRequirementId);
        setDraft(defaultScheduleAssignmentDraft(memberList[0]?.id ?? ''));
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '加载排期表单失败');
        }
      } finally {
        if (!cancelled) {
          setMetaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    pickerEnabled,
    editing?.id,
    initialProjectId,
    initialRequirementId,
    toast,
  ]);

  function handleProjectChange(value: string) {
    setProjectId(value);
    setRequirementId('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pickerEnabled && !projectId) {
      toast.error('请选择项目');
      return;
    }
    if (!resolvedRequirementId) {
      toast.error(pickerEnabled && projectId ? '请选择需求' : '请先选择项目，再选择需求');
      return;
    }
    if (!draft.userId) {
      toast.error('请选择成员');
      return;
    }
    if (!draft.role) {
      toast.error('请选择角色');
      return;
    }
    if (!draft.plannedStartDate || !draft.plannedEndDate) {
      toast.error('请填写计划起止日期');
      return;
    }
    if (draft.plannedEndDate < draft.plannedStartDate) {
      toast.error('结束日期不能早于开始日期');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        userId: draft.userId,
        role: draft.role,
        plannedStartDate: draft.plannedStartDate,
        plannedEndDate: draft.plannedEndDate,
        note: draft.note || undefined,
      };

      if (editing) {
        await api.updateRequirementAssignment(resolvedRequirementId, editing.id, payload);
        toast.success('排期已更新');
      } else {
        await api.createRequirementAssignment(resolvedRequirementId, payload);
        toast.success('排期已添加');
      }

      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存排期失败');
    } finally {
      setSubmitting(false);
    }
  }

  const title = editing ? '编辑排期' : pickerEnabled ? '新建排期' : '添加排期';
  const description = pickerEnabled
    ? '请先选择项目，再选择该项目下的需求，并配置成员、角色与计划起止日期。'
    : fixedRequirementTitle
      ? `为需求「${fixedRequirementTitle}」指定成员、角色和计划起止日期。`
      : '为这条需求指定成员、角色和计划起止日期。';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          {pickerEnabled ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  项目 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={projectId || undefined}
                  onValueChange={handleProjectChange}
                  disabled={metaLoading || projects.length === 0}
                  required
                >
                  <SelectTrigger aria-label="选择项目">
                    <SelectValue placeholder={metaLoading ? '加载中…' : '请选择项目'} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  需求 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={requirementId || undefined}
                  onValueChange={setRequirementId}
                  disabled={metaLoading || !projectId || !requirementPickerReady}
                  required
                >
                  <SelectTrigger aria-label="选择需求">
                    <SelectValue
                      placeholder={
                        metaLoading
                          ? '加载中…'
                          : !projectId
                            ? '请先选择项目'
                            : requirementOptions.length === 0
                              ? '该项目下暂无需求'
                              : '请选择需求'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {requirementOptions.map((req) => (
                      <SelectItem key={req.id} value={req.id}>
                        {req.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              成员 <span className="text-destructive">*</span>
            </label>
            <Select
              value={draft.userId || undefined}
              onValueChange={(value) => setDraft((c) => ({ ...c, userId: value }))}
              disabled={metaLoading || members.length === 0}
              required
            >
              <SelectTrigger aria-label="选择成员">
                <SelectValue placeholder="请选择成员" />
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
            <label className="text-sm font-semibold text-foreground">
              角色 <span className="text-destructive">*</span>
            </label>
            <Select
              value={draft.role}
              onValueChange={(value) => setDraft((c) => ({ ...c, role: value }))}
              required
            >
              <SelectTrigger aria-label="选择角色">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                开始日期 <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                required
                value={draft.plannedStartDate}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, plannedStartDate: event.target.value }))
                }
                aria-label="开始日期"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                结束日期 <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                required
                value={draft.plannedEndDate}
                min={draft.plannedStartDate}
                onChange={(event) =>
                  setDraft((c) => ({ ...c, plannedEndDate: event.target.value }))
                }
                aria-label="结束日期"
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || metaLoading}>
              {editing ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
