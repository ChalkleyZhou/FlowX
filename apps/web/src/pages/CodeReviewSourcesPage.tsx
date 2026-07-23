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

  function isExcluded(repositoryId: string) {
    const source = sourceByRepositoryId.get(repositoryId);
    return Boolean(source && !source.isActive);
  }

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

  async function excludeRepository(repository: Repository) {
    if (!workspaceId) {
      return;
    }
    setPendingRepositoryId(repository.id);
    try {
      const existing = sourceByRepositoryId.get(repository.id);
      if (existing) {
        await api.updateCodeReviewSource(existing.id, { isActive: false });
      } else {
        await api.createCodeReviewSource({
          workspaceId,
          repositoryId: repository.id,
          isActive: false,
        });
      }
      await refresh(workspaceId);
      toast.success(`已将「${repository.name}」排除出 Code Review`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '排除仓库失败');
    } finally {
      setPendingRepositoryId(null);
    }
  }

  async function includeRepository(repository: Repository) {
    const existing = sourceByRepositoryId.get(repository.id);
    if (!existing) {
      return;
    }
    setPendingRepositoryId(repository.id);
    try {
      // Delete exclusion row so the repo returns to the default "all included" set.
      await api.deleteCodeReviewSource(existing.id);
      await refresh(workspaceId);
      toast.success(`已恢复纳入「${repository.name}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复纳入失败');
    } finally {
      setPendingRepositoryId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Code Review Sources"
        title="Code Review 数据源"
        description="默认审查工作区全部仓库。仅需在此排除不想纳入每日 Code Review 的仓库；与简报数据源相互独立。"
      />
      <Card className="rounded-md border border-border bg-card">
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
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Repositories" title="仓库列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <Spinner className="h-7 w-7" />
          ) : repositories.length > 0 ? (
            <div className="flex flex-col gap-3">
              {repositories.map((repository) => {
                const excluded = isExcluded(repository.id);
                const isPending = pendingRepositoryId === repository.id;
                return (
                  <div
                    key={repository.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
                  >
                    <div>
                      <div className="font-semibold text-foreground">{repository.name}</div>
                      <div className="text-xs text-muted-foreground">{repository.url}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={excluded ? 'outline' : 'default'}>
                        {excluded ? '已排除' : '默认纳入'}
                      </Badge>
                      {excluded ? (
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => void includeRepository(repository)}
                        >
                          恢复纳入
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => void excludeRepository(repository)}
                        >
                          排除
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
