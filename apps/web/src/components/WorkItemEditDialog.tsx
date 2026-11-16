import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import type { WorkItem } from '../types';
import { PagedSelect } from './PagedSelect';
import { Badge } from './ui/badge';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

interface EditDraft {
  title: string;
  description: string;
  priority: string;
  versionId: string;
  remark: string;
}

const priorityOptions = [
  { id: 'URGENT', label: '紧急' },
  { id: 'HIGH', label: '高' },
  { id: 'MEDIUM', label: '中' },
  { id: 'LOW', label: '低' },
];

function kindLabel(kind: WorkItem['kind']) {
  return kind === 'REQUIREMENT' ? '需求' : kind === 'ISSUE' ? '问题' : '缺陷';
}

function draftFrom(workItem: WorkItem): EditDraft {
  return {
    title: workItem.title,
    description: workItem.description ?? '',
    priority: workItem.priority || 'MEDIUM',
    versionId: workItem.versionId ?? '',
    remark: workItem.remark ?? '',
  };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-foreground" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function WorkItemEditDialog({
  workItem,
  open,
  onOpenChange,
  onSaved,
}: {
  workItem: WorkItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (workItem: WorkItem) => void;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(workItem));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(workItem));
    setError(null);
    setSaving(false);
  }, [open, workItem]);

  const priorityChoices = priorityOptions.some(option => option.id === draft.priority)
    ? priorityOptions
    : [{ id: draft.priority, label: draft.priority }, ...priorityOptions];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError('请填写标题');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateWorkItem(workItem.id, {
        title,
        description: draft.description.trim(),
        priority: draft.priority,
        versionId: draft.versionId || null,
        remark: draft.remark.trim(),
        updatedAt: workItem.updatedAt,
      });
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存工作项失败');
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑{kindLabel(workItem.kind)}</DialogTitle>
          <DialogDescription>快速修改当前工作项的常用信息，复杂配置请进入统一详情。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <Badge variant="outline">{workItem.displayCode ?? workItem.id}</Badge>
          <Badge variant="secondary" data-work-item-status>{workItem.status}</Badge>
          <span className="text-muted-foreground">类型：{kindLabel(workItem.kind)}</span>
        </div>
        <form className="flex flex-col gap-4" onSubmit={event => void save(event)}>
          <fieldset disabled={saving} className="contents">
            <Field label="标题（必填）" htmlFor="work-item-edit-title">
              <Input id="work-item-edit-title" required value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
            </Field>
            <Field label="描述" htmlFor="work-item-edit-description">
              <Textarea id="work-item-edit-description" rows={5} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} />
            </Field>
            <Field label="优先级">
              <Select value={draft.priority} onValueChange={value => setDraft(current => ({ ...current, priority: value }))}>
                <SelectTrigger aria-label="优先级"><SelectValue /></SelectTrigger>
                <SelectContent>{priorityChoices.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="版本">
              <PagedSelect
                value={draft.versionId}
                selectedLabel={workItem.version?.id === draft.versionId ? workItem.version.name : undefined}
                label="版本"
                placeholder="未挂版本"
                allowClear
                emptyLabel="未挂版本"
                scopeKey={workItem.projectId}
                loadPage={query => api.listProjectVersions(workItem.projectId, query)}
                onValueChange={value => setDraft(current => ({ ...current, versionId: value }))}
              />
            </Field>
            <Field label="备注" htmlFor="work-item-edit-remark">
              <Textarea id="work-item-edit-remark" rows={3} value={draft.remark} onChange={event => setDraft(current => ({ ...current, remark: event.target.value }))} />
            </Field>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit">{saving ? '保存中…' : '保存'}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
