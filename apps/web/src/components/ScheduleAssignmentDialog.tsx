import { useEffect, useState } from 'react';
import { api } from '../api';
import { PagedSelect } from './PagedSelect';
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
import type { RequirementAssignment } from '../types';
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
  const [projectLabel, setProjectLabel] = useState('');
  const [requirementLabel, setRequirementLabel] = useState('');
  const [memberLabel, setMemberLabel] = useState('');
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
    if (!open) return;
    let cancelled = false;
    setMetaLoading(true);
    setProjectLabel(''); setRequirementLabel(''); setMemberLabel(editing?.user?.displayName ?? '');
    void Promise.all([
      initialProjectId && pickerEnabled ? api.getProject(initialProjectId).then(item => { if (!cancelled) setProjectLabel(item.name); }) : Promise.resolve(),
      initialRequirementId && pickerEnabled ? api.getRequirement(initialRequirementId).then(item => { if (!cancelled) setRequirementLabel(item.title); }) : Promise.resolve(),
      !editing ? api.getOrganizationMembers({page:1,pageSize:20}).then(result => {
        if (!cancelled && result.items[0]) { setDraft(current => current.userId ? current : ({...current,userId:result.items[0].id})); setMemberLabel(result.items[0].displayName); }
      }) : Promise.resolve(),
    ]).catch(error => { if (!cancelled) toast.error(error instanceof Error ? error.message : '加载排期表单失败'); })
      .finally(() => { if (!cancelled) setMetaLoading(false); });
    return () => { cancelled = true; };
  }, [open, editing?.id, initialProjectId, initialRequirementId, pickerEnabled]);

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
                <PagedSelect value={projectId} onValueChange={value => {setProjectLabel('');handleProjectChange(value);}}
                  label="选择项目" placeholder="请选择项目" selectedLabel={projectLabel} loadPage={api.getProjects} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  需求 <span className="text-destructive">*</span>
                </label>
                <PagedSelect value={requirementId} onValueChange={value => {setRequirementLabel('');setRequirementId(value);}}
                  label="选择需求" placeholder={projectId ? '请选择需求' : '请先选择项目'} selectedLabel={requirementLabel} disabled={!projectId} scopeKey={projectId}
                  loadPage={async query => {const result = await api.getRequirements({...query,projectId});return {...result,items:result.items.map(item => ({id:item.id,name:item.title}))};}} />
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              成员 <span className="text-destructive">*</span>
            </label>
            <PagedSelect value={draft.userId} onValueChange={value => {setMemberLabel('');setDraft(current => ({...current,userId:value}));}}
              label="选择成员" placeholder="请选择成员" selectedLabel={memberLabel}
              loadPage={async query => {const result = await api.getOrganizationMembers(query);return {...result,items:result.items.map(item => ({id:item.id,name:item.displayName}))};}} />
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
