import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { CodeReviewSource, Repository, Workspace } from '../types';

export function CodeReviewSourcesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sources, setSources] = useState<CodeReviewSource[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRepositoryId, setPendingRepositoryId] = useState<string | null>(null);
  const toast = useToast();

  const repositories = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId)?.repositories ?? [],
    [workspaces, workspaceId],
  );

  const sourceByRepositoryId = useMemo(() => {
    const map = new Map<string, CodeReviewSource>();
    for (const source of sources) {
      map.set(source.repositoryId, source);
    }
    return map;
  }, [sources]);

  async function refresh(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) {
      return;
    }
    setSources(await api.getCodeReviewSources({ workspaceId: nextWorkspaceId }));
  }

  useEffect(() => {
    setLoading(true);
    api
      .getWorkspaces()
      .then(async (workspaceList) => {
        setWorkspaces(workspaceList);
        const firstWorkspaceId = workspaceId || workspaceList[0]?.id || '';
        setWorkspaceId(firstWorkspaceId);
        if (firstWorkspaceId) {
          setSources(await api.getCodeReviewSources({ workspaceId: firstWorkspaceId }));
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载数据源失败'))
      .finally(() => setLoading(false));
  }, []);

  async function enableRepository(repository: Repository) {
    if (!workspaceId) {
      return;
    }
    setPendingRepositoryId(repository.id);
    try {
      await api.createCodeReviewSource({ workspaceId, repositoryId: repository.id, isActive: true });
      await refresh(workspaceId);
      toast.success(`已将「${repository.name}」加入 Code Review 数据源`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加数据源失败');
    } finally {
      setPendingRepositoryId(null);
    }
  }

  async function toggleSource(source: CodeReviewSource, repositoryName: string) {
    setPendingRepositoryId(source.repositoryId);
    try {
      await api.updateCodeReviewSource(source.id, { isActive: !source.isActive });
      await refresh(workspaceId);
      toast.success(source.isActive ? `已停用「${repositoryName}」` : `已启用「${repositoryName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新数据源失败');
    } finally {
      setPendingRepositoryId(null);
    }
  }

  async function removeSource(source: CodeReviewSource, repositoryName: string) {
    if (!window.confirm(`确认从 Code Review 数据源中移除「${repositoryName}」吗？`)) {
      return;
    }
    setPendingRepositoryId(source.repositoryId);
    try {
      await api.deleteCodeReviewSource(source.id);
      await refresh(workspaceId);
      toast.success(`已移除「${repositoryName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除数据源失败');
    } finally {
      setPendingRepositoryId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Code Review Sources"
        title="Code Review 数据源"
        description="选择需要纳入每日 Code Review 审查范围的仓库；未加入的仓库不会被审查，与简报数据源相互独立。"
      />
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Workspace" title="选择工作区" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <Select
            value={workspaceId || undefined}
            onValueChange={(value) => {
              setWorkspaceId(value);
              void refresh(value);
            }}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue placeholder="工作区" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Repositories" title="仓库列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <Spinner className="h-7 w-7" />
          ) : repositories.length > 0 ? (
            <div className="flex flex-col gap-3">
              {repositories.map((repository) => {
                const source = sourceByRepositoryId.get(repository.id);
                const isPending = pendingRepositoryId === repository.id;
                return (
                  <div
                    key={repository.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{repository.name}</div>
                      <div className="text-xs text-muted-foreground">{repository.url}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {source ? (
                        <>
                          <Badge variant={source.isActive ? 'default' : 'outline'}>
                            {source.isActive ? '已加入 Code Review' : '已停用'}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => void toggleSource(source, repository.name)}
                          >
                            {source.isActive ? '停用' : '启用'}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isPending}
                            onClick={() => void removeSource(source, repository.name)}
                          >
                            移除
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => void enableRepository(repository)}
                        >
                          加入 Code Review
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="该工作区暂无仓库" description="请先在工作区中登记代码仓库。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
