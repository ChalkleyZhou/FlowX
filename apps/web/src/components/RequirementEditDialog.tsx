import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import type { ProjectVersionSummary, Requirement } from '../types';
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

const UNVERSIONED = '__none__';

const priorityOptions = [
  { id: 'URGENT', label: '紧急' },
  { id: 'HIGH', label: '高' },
  { id: 'MEDIUM', label: '中' },
  { id: 'LOW', label: '低' },
];

interface EditDraft {
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: string;
  versionId: string;
  functionalModule: string;
  riskImpact: string;
  productRequirementDocument: string;
  remark: string;
}

function draftFrom(requirement: Requirement): EditDraft {
  return {
    title: requirement.title,
    description: requirement.description ?? '',
    acceptanceCriteria: requirement.acceptanceCriteria ?? '',
    priority: requirement.priority || 'MEDIUM',
    versionId: requirement.versionId ?? '',
    functionalModule: requirement.functionalModule ?? '',
    riskImpact: requirement.riskImpact ?? '',
    productRequirementDocument: requirement.productRequirementDocument ?? '',
    remark: requirement.remark ?? '',
  };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-foreground" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export function RequirementEditDialog({
  requirement,
  versions,
  open,
  onOpenChange,
  onSaved,
}: {
  requirement: Requirement;
  versions: ProjectVersionSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (requirement: Requirement) => void;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(requirement));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(draftFrom(requirement));
    setError(null);
    setSaving(false);
  }, [open, requirement]);

  const versionChoices = useMemo(() => {
    const choices = [...versions];
    if (requirement.version && !choices.some((item) => item.id === requirement.version?.id)) {
      choices.unshift(requirement.version);
    }
    return choices;
  }, [requirement.version, versions]);

  const priorityChoices = priorityOptions.some((option) => option.id === draft.priority)
    ? priorityOptions
    : [{ id: draft.priority, label: draft.priority }, ...priorityOptions];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError('请填写需求名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateRequirement(requirement.id, {
        title,
        description: draft.description.trim(),
        acceptanceCriteria: draft.acceptanceCriteria.trim(),
        priority: draft.priority,
        versionId: draft.versionId || null,
        functionalModule: draft.functionalModule.trim(),
        riskImpact: draft.riskImpact.trim(),
        productRequirementDocument: draft.productRequirementDocument.trim(),
        remark: draft.remark.trim(),
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存需求失败');
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑需求</DialogTitle>
          <DialogDescription>修改需求内容和补充档案。创建人与创建时间保持不变。</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
          <fieldset disabled={saving} className="contents">
            <Field label="需求名称（必填）" htmlFor="edit-requirement-title">
              <Input
                id="edit-requirement-title"
                required
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </Field>
            <Field label="需求描述" htmlFor="edit-requirement-description">
              <Textarea
                id="edit-requirement-description"
                rows={4}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </Field>
            <Field label="优先级">
              <Select value={draft.priority} onValueChange={(value) => setDraft((current) => ({ ...current, priority: value }))}>
                <SelectTrigger aria-label="优先级">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityChoices.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="发布版本">
              <Select
                value={draft.versionId || UNVERSIONED}
                onValueChange={(value) => setDraft((current) => ({ ...current, versionId: value === UNVERSIONED ? '' : value }))}
              >
                <SelectTrigger aria-label="发布版本">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNVERSIONED}>未挂版本</SelectItem>
                  {versionChoices.map((version) => (
                    <SelectItem key={version.id} value={version.id}>{version.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="功能模块" htmlFor="edit-requirement-module">
              <Input
                id="edit-requirement-module"
                value={draft.functionalModule}
                onChange={(event) => setDraft((current) => ({ ...current, functionalModule: event.target.value }))}
              />
            </Field>
            <Field label="风险&影响" htmlFor="edit-requirement-risk">
              <Textarea
                id="edit-requirement-risk"
                rows={3}
                value={draft.riskImpact}
                onChange={(event) => setDraft((current) => ({ ...current, riskImpact: event.target.value }))}
              />
            </Field>
            <Field label="产品需求文档" htmlFor="edit-requirement-prd">
              <Textarea
                id="edit-requirement-prd"
                rows={3}
                value={draft.productRequirementDocument}
                onChange={(event) => setDraft((current) => ({ ...current, productRequirementDocument: event.target.value }))}
              />
            </Field>
            <Field label="备注" htmlFor="edit-requirement-remark">
              <Textarea
                id="edit-requirement-remark"
                rows={3}
                value={draft.remark}
                onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))}
              />
            </Field>
            <Field label="验收标准" htmlFor="edit-requirement-acceptance">
              <Textarea
                id="edit-requirement-acceptance"
                rows={3}
                value={draft.acceptanceCriteria}
                onChange={(event) => setDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
              />
            </Field>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <Button type="submit">{saving ? '保存中…' : '保存'}</Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
