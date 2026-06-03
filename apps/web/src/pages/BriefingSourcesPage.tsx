import { useEffect, useMemo, useState } from 'react';
import { api, toApiUrl } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { BriefingSource, Repository, Workspace } from '../types';

export function BriefingSourcesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sources, setSources] = useState<BriefingSource[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [gitlabProjectId, setGitlabProjectId] = useState('');
  const [pathWithNamespace, setPathWithNamespace] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId),
    [workspaces, workspaceId],
  );
  const repositories = selectedWorkspace?.repositories ?? [];

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setSources(await api.getBriefingSources({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    setLoading(true);
    api.getWorkspaces()
      .then(async (workspaceList) => {
        setWorkspaces(workspaceList);
        const firstWorkspaceId = workspaceId || workspaceList[0]?.id || '';
        setWorkspaceId(firstWorkspaceId);
        setRepositoryId(workspaceList[0]?.repositories[0]?.id ?? '');
        if (firstWorkspaceId) {
          setSources(await api.getBriefingSources({ workspaceId: firstWorkspaceId }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载数据源失败'))
      .finally(() => setLoading(false));
  }, []);

  async function createSource() {
    if (!workspaceId || !repositoryId || !gitlabProjectId || !pathWithNamespace || !webhookSecret) {
      toast.error('请填写完整数据源信息');
      return;
    }
    try {
      await api.createBriefingSource({
        workspaceId,
        repositoryId,
        gitlabProjectId: Number(gitlabProjectId),
        pathWithNamespace,
        webhookSecret,
      });
      setGitlabProjectId('');
      setPathWithNamespace('');
      setWebhookSecret('');
      await refresh(workspaceId);
      toast.success('数据源已创建');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建数据源失败');
    }
  }

  async function toggleSource(source: BriefingSource) {
    await api.updateBriefingSource(source.id, { isActive: !source.isActive });
    await refresh(workspaceId);
  }

  async function deleteSource(source: BriefingSource) {
    if (!window.confirm(`确认删除 ${source.pathWithNamespace} 吗？`)) {
      return;
    }
    await api.deleteBriefingSource(source.id);
    await refresh(workspaceId);
  }

  return (
    <>
      <PageHeader eyebrow="Briefing Sources" title="简报数据源" description="为工作区仓库配置独立的 GitLab webhook 数据源。" />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Create" title="新增数据源" />
        </CardHeader>
        <CardContent className="grid gap-3 p-5 pt-0 md:grid-cols-5">
          <Select value={workspaceId || undefined} onValueChange={(value) => { setWorkspaceId(value); setRepositoryId(''); void refresh(value); }}>
            <SelectTrigger><SelectValue placeholder="工作区" /></SelectTrigger>
            <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={repositoryId || undefined} onValueChange={setRepositoryId}>
            <SelectTrigger><SelectValue placeholder="仓库" /></SelectTrigger>
            <SelectContent>{repositories.map((repository: Repository) => <SelectItem key={repository.id} value={repository.id}>{repository.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="GitLab Project ID" value={gitlabProjectId} onChange={(event) => setGitlabProjectId(event.target.value)} />
          <Input placeholder="path/with/namespace" value={pathWithNamespace} onChange={(event) => setPathWithNamespace(event.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Webhook Secret" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} />
            <Button onClick={createSource}>保存</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Sources" title="数据源列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? <Spinner className="h-7 w-7" /> : sources.length > 0 ? (
            <div className="flex flex-col gap-3">
              {sources.map((source) => (
                <div key={source.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground">{source.pathWithNamespace}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{toApiUrl(`/briefing-sources/${source.id}/gitlab-webhook`)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={source.isActive ? 'default' : 'outline'}>{source.isActive ? '启用' : '停用'}</Badge>
                      <Button variant="outline" size="sm" onClick={() => void toggleSource(source)}>{source.isActive ? '停用' : '启用'}</Button>
                      <Button variant="destructive" size="sm" onClick={() => void deleteSource(source)}>删除</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="暂无数据源" description="为工作区仓库添加 GitLab webhook 数据源。" />}
        </CardContent>
      </Card>
    </>
  );
}

