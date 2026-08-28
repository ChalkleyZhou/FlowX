import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Repository, Workspace } from '../types';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RepositoryBranchCard } from '../components/RepositoryBranchCard';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ConfirmDialog';
import { formatRepositorySyncStatus } from '../utils/label-utils';

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [editRepositoryModalOpen, setEditRepositoryModalOpen] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [repositoryWorkspaceId, setRepositoryWorkspaceId] = useState('');
  const [editingRepositoryMeta, setEditingRepositoryMeta] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [editingRepository, setEditingRepository] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState({ name: '', description: '' });
  const [repositoryDraft, setRepositoryDraft] = useState({ name: '', url: '', defaultBranch: '' });
  const [repositoryEditDraft, setRepositoryEditDraft] = useState({ name: '', url: '', defaultBranch: '' });
  const [branchDraft, setBranchDraft] = useState({ currentBranch: '' });
  const [addingRepository, setAddingRepository] = useState(false);
  const [updatingRepositoryMeta, setUpdatingRepositoryMeta] = useState(false);
  const [resyncingRepositoryId, setResyncingRepositoryId] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const workspaceSummary = useMemo(() => {
    const repositoryCount = workspaces.reduce((sum, workspace) => sum + workspace.repositories.length, 0);
    const projectCount = workspaces.reduce((sum, workspace) => sum + (workspace._count?.projects ?? 0), 0);
    const requirementCount = workspaces.reduce((sum, workspace) => sum + (workspace._count?.requirements ?? 0), 0);
    return {
      workspaceCount: workspaces.length,
      repositoryCount,
      projectCount,
      requirementCount,
    };
  }, [workspaces]);

  async function refresh(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      setWorkspaces(await api.getWorkspaces());
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : '加载工作区失败');
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  const hasPendingRepositorySync = useMemo(
    () =>
      workspaces.some((workspace) =>
        workspace.repositories.some(
          (repository) => repository.syncStatus === 'PENDING' || repository.syncStatus === 'SYNCING',
        ),
      ),
    [workspaces],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!hasPendingRepositorySync) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [hasPendingRepositorySync]);

  async function createWorkspace(values: { name: string; description?: string }) {
    try {
      await api.createWorkspace(values);
      setWorkspaceDraft({ name: '', description: '' });
      setWorkspaceModalOpen(false);
      await refresh();
      toast.success('工作区创建成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建工作区失败');
    }
  }

  async function addRepository(values: { name: string; url: string; defaultBranch?: string }) {
    setAddingRepository(true);
    try {
      await api.addRepositoryToWorkspace(repositoryWorkspaceId, values);
      setRepositoryDraft({ name: '', url: '', defaultBranch: '' });
      setRepositoryModalOpen(false);
      setRepositoryWorkspaceId('');
      await refresh();
      toast.success('代码库已加入工作区，正在后台同步');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加代码库失败');
    } finally {
      setAddingRepository(false);
    }
  }

  async function resyncRepository(workspaceId: string, repository: Repository) {
    setResyncingRepositoryId(repository.id);
    try {
      await api.resyncWorkspaceRepository(workspaceId, repository.id);
      await refresh();
      toast.success('已重新触发代码库同步');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新同步失败');
    } finally {
      setResyncingRepositoryId(null);
    }
  }

  async function updateBranch(values: { currentBranch: string }) {
    if (!editingRepository) {
      return;
    }
    try {
      await api.updateRepositoryBranch(editingRepository.workspaceId, editingRepository.repository.id, values);
      setBranchDraft({ currentBranch: '' });
      setBranchModalOpen(false);
      setEditingRepository(null);
      await refresh();
      toast.success('分支已切换并同步');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新分支失败');
    }
  }

  async function updateRepositoryMeta(values: { name: string; url: string; defaultBranch?: string }) {
    if (!editingRepositoryMeta) {
      return;
    }
    setUpdatingRepositoryMeta(true);
    try {
      await api.updateRepository(editingRepositoryMeta.workspaceId, editingRepositoryMeta.repository.id, values);
      setRepositoryEditDraft({ name: '', url: '', defaultBranch: '' });
      setEditRepositoryModalOpen(false);
      setEditingRepositoryMeta(null);
      await refresh();
      toast.success('代码库信息已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新代码库失败');
    } finally {
      setUpdatingRepositoryMeta(false);
    }
  }

  async function deleteRepository(workspaceId: string, repository: Repository) {
    const confirmed = await confirm({
      description: `确认删除代码库“${repository.name}”吗？这会移除工作区中的仓库记录和本地副本。`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      await api.deleteRepository(workspaceId, repository.id);
      await refresh();
      toast.success('代码库已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除代码库失败');
    }
  }

  async function handleCreateWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceDraft.name.trim()) {
      toast.error('请输入工作区名称');
      return;
    }
    await createWorkspace({
      name: workspaceDraft.name.trim(),
      description: workspaceDraft.description.trim() || undefined,
    });
  }

  async function handleAddRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repositoryDraft.name.trim() || !repositoryDraft.url.trim()) {
      toast.error('请填写代码库名称和仓库地址');
      return;
    }
    await addRepository({
      name: repositoryDraft.name.trim(),
      url: repositoryDraft.url.trim(),
      defaultBranch: repositoryDraft.defaultBranch.trim() || undefined,
    });
  }

  async function handleUpdateBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchDraft.currentBranch.trim()) {
      toast.error('请输入当前分支');
      return;
    }
    await updateBranch({ currentBranch: branchDraft.currentBranch.trim() });
  }

  async function handleUpdateRepositoryMeta(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repositoryEditDraft.name.trim() || !repositoryEditDraft.url.trim()) {
      toast.error('请填写代码库名称和仓库地址');
      return;
    }
    await updateRepositoryMeta({
      name: repositoryEditDraft.name.trim(),
      url: repositoryEditDraft.url.trim(),
      defaultBranch: repositoryEditDraft.defaultBranch.trim() || undefined,
    });
  }

  return (
    <>
      <Dialog
        open={workspaceModalOpen}
        onOpenChange={(open) => {
          setWorkspaceModalOpen(open);
          if (!open) {
            setWorkspaceDraft({ name: '', description: '' });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建工作区</DialogTitle>
            <DialogDescription>先定义项目边界，再把代码库纳入统一工作区上下文。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateWorkspace(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="workspace-name">工作区名称</label>
              <UiInput
                id="workspace-name"
                value={workspaceDraft.name}
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：FlowX 平台"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="workspace-description">描述</label>
              <Textarea
                id="workspace-description"
                rows={3}
                value={workspaceDraft.description}
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="说明这个工作区对应的项目或业务边界。"
              />
            </div>
            <UiButton type="submit">创建工作区</UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={repositoryModalOpen}
        onOpenChange={(open) => {
          setRepositoryModalOpen(open);
          if (!open) {
            setRepositoryDraft({ name: '', url: '', defaultBranch: '' });
            setRepositoryWorkspaceId('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>收录代码库</DialogTitle>
            <DialogDescription>保存仓库地址后，系统会拉取基线仓库并记录默认分支。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleAddRepository(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-name">代码库名称</label>
              <UiInput
                id="repository-name"
                value={repositoryDraft.name}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：flowx-web"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-url">仓库地址</label>
              <UiInput
                id="repository-url"
                value={repositoryDraft.url}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="git clone 可用的仓库地址"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-default-branch">默认分支</label>
              <UiInput
                id="repository-default-branch"
                value={repositoryDraft.defaultBranch}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, defaultBranch: event.target.value }))}
                placeholder="main / master / develop"
              />
            </div>
            <UiButton type="submit" disabled={addingRepository}>
              {addingRepository ? '提交中...' : '添加代码库'}
            </UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editRepositoryModalOpen}
        onOpenChange={(open) => {
          setEditRepositoryModalOpen(open);
          if (!open) {
            setEditingRepositoryMeta(null);
            setRepositoryEditDraft({ name: '', url: '', defaultBranch: '' });
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑代码库</DialogTitle>
            <DialogDescription>修改仓库地址后会清理旧副本并重新同步，当前分支不会自动切换。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleUpdateRepositoryMeta(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-edit-name">代码库名称</label>
              <UiInput
                id="repository-edit-name"
                value={repositoryEditDraft.name}
                onChange={(event) => setRepositoryEditDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：flowx-web"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-edit-url">仓库地址</label>
              <UiInput
                id="repository-edit-url"
                value={repositoryEditDraft.url}
                onChange={(event) => setRepositoryEditDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="git clone 可用的仓库地址"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-edit-default-branch">默认分支</label>
              <UiInput
                id="repository-edit-default-branch"
                value={repositoryEditDraft.defaultBranch}
                onChange={(event) => setRepositoryEditDraft((current) => ({ ...current, defaultBranch: event.target.value }))}
                placeholder="main / master / develop"
              />
            </div>
            <DialogFooter className="border-t border-border pt-4">
              <UiButton
                type="submit"
                className="min-w-[140px]"
                disabled={updatingRepositoryMeta}
              >
                {updatingRepositoryMeta ? '保存中...' : '保存代码库信息'}
              </UiButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={branchModalOpen}
        onOpenChange={(open) => {
          setBranchModalOpen(open);
          if (!open) {
            setEditingRepository(null);
            setBranchDraft({ currentBranch: '' });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更新当前分支</DialogTitle>
            <DialogDescription>切换后会同步仓库上下文，供后续工作流基于该分支创建独立副本。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleUpdateBranch(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="repository-current-branch">当前分支</label>
              <UiInput
                id="repository-current-branch"
                value={branchDraft.currentBranch}
                onChange={(event) => setBranchDraft({ currentBranch: event.target.value })}
                placeholder="例如：feature/workspace-page"
              />
            </div>
            <UiButton type="submit">保存分支</UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Workspace"
        title="项目工作区与代码库"
        description="统一管理协作底座、仓库分支与本地副本，项目和需求会在这层之上继续拆分。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="工作区数量" value={workspaceSummary.workspaceCount} />
        <MetricCard label="代码库数量" value={workspaceSummary.repositoryCount} />
        <MetricCard label="项目数量" value={workspaceSummary.projectCount} />
        <MetricCard label="关联需求数" value={workspaceSummary.requirementCount} />
      </div>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Project Space"
            title="按项目组织需求上下文"
            extra={
              <UiButton onClick={() => setWorkspaceModalOpen(true)}>新建工作区</UiButton>
            }
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading && workspaces.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : workspaces.length > 0 ? (
            <div className="flex flex-col gap-3.5">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="border-b border-border py-4 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-base font-semibold leading-6 text-foreground">{workspace.name}</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{workspace.description || '未填写描述'}</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <Badge variant="warning">{workspace.repositories.length} 个代码库</Badge>
                      <Badge variant="secondary">{workspace._count?.projects ?? 0} 个项目</Badge>
                      <Badge variant="default">{workspace._count?.requirements ?? 0} 条需求</Badge>
                    </div>
                  </div>
                  <UiButton
                    variant="secondary"
                    onClick={() => {
                      setRepositoryWorkspaceId(workspace.id);
                      setRepositoryModalOpen(true);
                    }}
                  >
                    添加代码库
                  </UiButton>
                </div>
                {workspace.repositories.length > 0 ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {workspace.repositories.map((repository) => (
                      <RepositoryBranchCard
                        key={repository.id}
                        name={repository.name}
                        primaryMeta={`默认分支 ${repository.defaultBranch ?? '未设置'}`}
                        secondaryMeta={`当前分支 ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}`}
                        statusLabel={`同步状态 ${formatRepositorySyncStatus(repository.syncStatus ?? 'PENDING')}`}
                        statusVariant={
                          repository.syncStatus === 'READY'
                            ? 'success'
                            : repository.syncStatus === 'ERROR'
                              ? 'destructive'
                              : 'warning'
                        }
                        error={repository.syncError ? `同步失败：${repository.syncError}` : undefined}
                        action={
                          <div className="flex flex-wrap gap-2">
                            {(repository.syncStatus === 'PENDING' ||
                              repository.syncStatus === 'SYNCING' ||
                              repository.syncStatus === 'ERROR') && (
                              <UiButton
                                variant="secondary"
                                size="sm"
                                disabled={resyncingRepositoryId === repository.id}
                                onClick={() => void resyncRepository(workspace.id, repository)}
                              >
                                {resyncingRepositoryId === repository.id ? '同步中...' : '重新同步'}
                              </UiButton>
                            )}
                            <UiButton
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingRepositoryMeta({ workspaceId: workspace.id, repository });
                                setRepositoryEditDraft({
                                  name: repository.name,
                                  url: repository.url,
                                  defaultBranch: repository.defaultBranch ?? '',
                                });
                                setEditRepositoryModalOpen(true);
                              }}
                            >
                              编辑
                            </UiButton>
                            <UiButton
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingRepository({ workspaceId: workspace.id, repository });
                                setBranchDraft({
                                  currentBranch: repository.currentBranch ?? repository.defaultBranch ?? '',
                                });
                                setBranchModalOpen(true);
                              }}
                            >
                              切换分支
                            </UiButton>
                            <UiButton
                              variant="destructive"
                              size="sm"
                              onClick={() => void deleteRepository(workspace.id, repository)}
                            >
                              删除
                            </UiButton>
                          </div>
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState description="还没有创建工作区，先建立项目上下文再收录代码库。" />
        )}
        </CardContent>
      </Card>
    </>
  );
}
