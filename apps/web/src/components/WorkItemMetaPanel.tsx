import { useEffect, useState } from 'react';
import { api } from '../api';
import type { WorkItem } from '../types';
import { formatPriority } from '../utils/label-utils';
import { PagedSelect } from './PagedSelect';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type EditableWorkItem = Pick<WorkItem, 'id' | 'priority' | 'versionId' | 'version' | 'ownerUser' | 'projectId' | 'workspaceId'>;

interface Props {
  workItem: EditableWorkItem;
  onSaved: (updated: Partial<WorkItem>) => void;
}

const priorityOptions = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export function WorkItemMetaPanel({ workItem, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    ownerUserId: workItem.ownerUser?.id ?? '',
    priority: workItem.priority || 'MEDIUM',
    versionId: workItem.versionId ?? '',
  });

  useEffect(() => {
    if (editing) return;
    setDraft({
      ownerUserId: workItem.ownerUser?.id ?? '',
      priority: workItem.priority || 'MEDIUM',
      versionId: workItem.versionId ?? '',
    });
  }, [editing, workItem.ownerUser?.id, workItem.priority, workItem.versionId]);

  function cancel() {
    setEditing(false);
    setError(null);
    setDraft({
      ownerUserId: workItem.ownerUser?.id ?? '',
      priority: workItem.priority || 'MEDIUM',
      versionId: workItem.versionId ?? '',
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateWorkItem(workItem.id, {
        ownerUserId: draft.ownerUserId || null,
        priority: draft.priority,
        versionId: draft.versionId || null,
      });
      onSaved(updated);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存工作项信息失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>工作项信息</CardTitle>
        {!editing ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>编辑</Button> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`work-item-owner-${workItem.id}`}>负责人</label>
              <PagedSelect
                id={`work-item-owner-${workItem.id}`}
                value={draft.ownerUserId}
                selectedLabel={workItem.ownerUser?.id === draft.ownerUserId ? workItem.ownerUser.displayName : undefined}
                label="负责人"
                placeholder="未指定负责人"
                emptyLabel="未指定负责人"
                allowClear
                scopeKey={workItem.workspaceId}
                loadPage={async query => {
                  const result = await api.getOrganizationMembers({ ...query, status: 'ACTIVE' });
                  return { ...result, items: result.items.map(member => ({ id: member.id, name: member.displayName || member.account || member.id })) };
                }}
                onValueChange={value => setDraft(current => ({ ...current, ownerUserId: value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`work-item-priority-${workItem.id}`}>优先级</label>
              <Select value={draft.priority} onValueChange={value => setDraft(current => ({ ...current, priority: value }))} disabled={saving}>
                <SelectTrigger id={`work-item-priority-${workItem.id}`} aria-label="优先级"><SelectValue /></SelectTrigger>
                <SelectContent>{priorityOptions.map(value => <SelectItem key={value} value={value}>{formatPriority(value)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`work-item-version-${workItem.id}`}>发布版本</label>
              <PagedSelect
                id={`work-item-version-${workItem.id}`}
                value={draft.versionId}
                selectedLabel={workItem.version?.id === draft.versionId ? workItem.version.name : undefined}
                label="发布版本"
                placeholder="未挂版本"
                emptyLabel="未挂版本"
                allowClear
                scopeKey={workItem.projectId}
                loadPage={query => api.listProjectVersions(workItem.projectId, query)}
                onValueChange={value => setDraft(current => ({ ...current, versionId: value }))}
                disabled={saving}
              />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={cancel} disabled={saving}>取消</Button>
              <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            </div>
          </>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">负责人</dt><dd>{workItem.ownerUser?.displayName ?? '未指定'}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">优先级</dt><dd><Badge variant="secondary">{formatPriority(workItem.priority)}</Badge></dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">发布版本</dt><dd>{workItem.version?.name ?? '未挂版本'}</dd></div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
