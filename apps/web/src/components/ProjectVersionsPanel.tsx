import { useEffect, useState } from 'react';
import { api } from '../api';
import { SectionHeader } from './SectionHeader';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { ProjectVersionSummary } from '../types';

interface ProjectVersionsPanelProps {
  projectId: string;
  currentVersionId?: string | null;
  onChanged?: () => Promise<void> | void;
}

export function ProjectVersionsPanel({
  projectId,
  currentVersionId,
  onChanged,
}: ProjectVersionsPanelProps) {
  const toast = useToast();
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setVersions(await api.listProjectVersions(projectId));
  }

  useEffect(() => {
    void refresh().catch((error) => {
      toast.error(error instanceof Error ? error.message : '加载版本失败');
    });
  }, [projectId]);

  async function createVersion() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('请填写版本名称');
      return;
    }
    setSaving(true);
    try {
      await api.createProjectVersion(projectId, { name: trimmed });
      setName('');
      await refresh();
      await onChanged?.();
      toast.success('版本已创建');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建版本失败');
    } finally {
      setSaving(false);
    }
  }

  async function setCurrent(versionId: string) {
    setSaving(true);
    try {
      await api.updateProjectCurrentVersion(projectId, versionId);
      await onChanged?.();
      toast.success('已设为当前版本');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置当前版本失败');
    } finally {
      setSaving(false);
    }
  }

  async function rename(version: ProjectVersionSummary) {
    const next = window.prompt('新的版本名称', version.name)?.trim();
    if (!next || next === version.name) {
      return;
    }
    setSaving(true);
    try {
      await api.updateProjectVersion(projectId, version.id, { name: next });
      await refresh();
      await onChanged?.();
      toast.success('版本已改名');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '改名失败');
    } finally {
      setSaving(false);
    }
  }

  async function remove(version: ProjectVersionSummary) {
    setSaving(true);
    try {
      await api.deleteProjectVersion(projectId, version.id);
      await refresh();
      await onChanged?.();
      toast.success('版本已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除版本失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-md border border-border bg-card">
      <CardHeader className="pb-4">
        <SectionHeader eyebrow="Versions" title="发布版本" description="维护本项目的发版清单，并标记当前版本。" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="版本名称"
            className="w-40"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="2.6.0"
          />
          <Button onClick={() => void createVersion()} disabled={saving}>
            新建版本
          </Button>
        </div>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有发布版本。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((version) => {
              const isCurrent = version.id === currentVersionId;
              return (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{version.name}</span>
                    {isCurrent ? <Badge variant="secondary">当前</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={saving || isCurrent} onClick={() => void setCurrent(version.id)}>
                      设为当前
                    </Button>
                    <Button variant="outline" size="sm" disabled={saving} onClick={() => void rename(version)}>
                      改名
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving || isCurrent}
                      title={isCurrent ? '仍是当前版本' : undefined}
                      onClick={() => void remove(version)}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
