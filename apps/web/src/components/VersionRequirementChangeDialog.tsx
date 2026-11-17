import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Requirement, RequirementChange } from '../types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

function requestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `version-change-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function VersionRequirementChangeDialog({
  requirement,
  versionId,
  open,
  onOpenChange,
  onSaved,
}: {
  requirement: Pick<Requirement, 'id' | 'title'> | null;
  versionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
}) {
  const [records, setRecords] = useState<RequirementChange[]>([]);
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !requirement) return;
    setContent('');
    setReason('');
    setError('');
    setLoading(true);
    void api.getRequirementChanges(requirement.id, undefined, { page: 1, pageSize: 20 })
      .then(result => setRecords(result.items))
      .catch(value => setError(value instanceof Error ? value.message : '变更记录加载失败'))
      .finally(() => setLoading(false));
  }, [open, requirement]);

  async function reload() {
    if (!requirement) return;
    const result = await api.getRequirementChanges(requirement.id, undefined, { page: 1, pageSize: 20 });
    setRecords(result.items);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requirement || !content.trim() || !reason.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.createRequirementChange(requirement.id, {
        content: content.trim(),
        reason: reason.trim(),
        mode: 'SUPPLEMENT',
        requestId: requestId(),
        versionId,
      });
      await reload();
      setContent('');
      setReason('');
      await onSaved?.();
    } catch (value) {
      setError(value instanceof Error ? value.message : '提交变更失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>需求变更</DialogTitle>
          <DialogDescription>变更只能记录在项目当前版本，提交后可在此查看历史记录。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-medium">{requirement?.title}</div>
          <form className="space-y-3" onSubmit={event => void submit(event)}>
            <label className="block space-y-2 text-sm">
              <span>变更内容</span>
              <Textarea value={content} onChange={event => setContent(event.target.value)} placeholder="请填写本次要调整的内容" maxLength={20000} rows={4} required disabled={saving} />
            </label>
            <label className="block space-y-2 text-sm">
              <span>变更原因</span>
              <Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="请说明为什么需要这次变更" maxLength={2000} rows={3} required disabled={saving} />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>关闭</Button>
              <Button type="submit" disabled={saving || !content.trim() || !reason.trim()}>{saving ? '正在提交…' : '提交变更'}</Button>
            </DialogFooter>
          </form>
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">变更记录{records.length ? ` · ${records.length}` : ''}</h3>
            {loading ? <p className="text-sm text-muted-foreground">正在加载变更记录…</p> : records.length === 0 ? <p className="text-sm text-muted-foreground">当前版本还没有变更记录。</p> : (
              <div className="max-h-64 space-y-3 overflow-y-auto">
                {records.map(record => (
                  <article key={record.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>第 {record.revision} 次变更</span>
                      <span>{record.createdByName}</span>
                      <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
                    </div>
                    <p className="whitespace-pre-wrap break-words">变更内容：{record.content}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">变更原因：{record.reason || '未填写'}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
