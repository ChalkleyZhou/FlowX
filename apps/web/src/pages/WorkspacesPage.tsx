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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import { formatRepositorySyncStatus } from '../utils/label-utils';

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [editRepositoryModalOpen, setEditRepositoryModalOpen] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [deployConfigModalOpen, setDeployConfigModalOpen] = useState(false);
  const [repositoryWorkspaceId, setRepositoryWorkspaceId] = useState('');
  const [editingRepositoryMeta, setEditingRepositoryMeta] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [editingRepository, setEditingRepository] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [deployConfigRepository, setDeployConfigRepository] = useState<{
    workspaceId: string;
    repository: Repository;
  } | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState({ name: '', description: '' });
  const [repositoryDraft, setRepositoryDraft] = useState({ name: '', url: '', defaultBranch: '' });
  const [repositoryEditDraft, setRepositoryEditDraft] = useState({ name: '', defaultBranch: '' });
  const [branchDraft, setBranchDraft] = useState({ currentBranch: '' });
  const [deployConfigDraft, setDeployConfigDraft] = useState({
    enabled: false,
    provider: 'noop',
    configText: '{}',
  });
  const [deployProviders, setDeployProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [deployConfigLoading, setDeployConfigLoading] = useState(false);
  const [deployConfigSaving, setDeployConfigSaving] = useState(false);
  const toast = useToast();

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

  async function refresh() {
    setLoading(true);
    try {
      setWorkspaces(await api.getWorkspaces());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载工作区失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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
    try {
      await api.addRepositoryToWorkspace(repositoryWorkspaceId, values);
      setRepositoryDraft({ name: '', url: '', defaultBranch: '' });
      setRepositoryModalOpen(false);
      setRepositoryWorkspaceId('');
      await refresh();
      toast.success('代码库已拉取并加入工作区');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加代码库失败');
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

  async function updateRepositoryMeta(values: { name: string; defaultBranch?: string }) {
    if (!editingRepositoryMeta) {
      return;
    }
    try {
      await api.updateRepository(editingRepositoryMeta.workspaceId, editingRepositoryMeta.repository.id, values);
      setRepositoryEditDraft({ name: '', defaultBranch: '' });
      setEditRepositoryModalOpen(false);
      setEditingRepositoryMeta(null);
      await refresh();
      toast.success('代码库信息已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新代码库失败');
    }
  }

  async function openDeployConfig(workspaceId: string, repository: Repository) {
    setDeployConfigLoading(true);
    try {
      const [config, providers] = await Promise.all([
        api.getRepositoryDeployConfig(repository.id),
        api.getDeployProviders().catch(() => ({
          defaultProvider: 'noop',
          providers: [],
        })),
      ]);

      const availableProviders = [
        ...providers.providers,
        { id: 'noop', label: 'No-op Deploy' },
        { id: 'rokid-ops', label: 'Rokid OPS' },
      ];
      setDeployProviders(
        availableProviders.filter(
          (provider, index, array) =>
            array.findIndex((entry) => entry.id === provider.id) === index,
        ),
      );
      setDeployConfigRepository({ workspaceId, repository });
      setDeployConfigDraft({
        enabled: config.enabled,
        provider: config.provider || providers.defaultProvider || 'noop',
        configText: JSON.stringify(config.configJson ?? {}, null, 2),
      });
      setDeployConfigModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取部署配置失败');
    } finally {
      setDeployConfigLoading(false);
    }
  }

  async function saveDeployConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deployConfigRepository) {
      return;
    }

    let parsedConfig: Record<string, unknown>;
    try {
      const parsed = JSON.parse(deployConfigDraft.configText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast.error('部署模板必须是 JSON 对象');
        return;
      }
      parsedConfig = parsed as Record<string, unknown>;
    } catch {
      toast.error('部署模板不是合法 JSON');
      return;
    }

    setDeployConfigSaving(true);
    try {
      await api.updateRepositoryDeployConfig(deployConfigRepository.repository.id, {
        enabled: deployConfigDraft.enabled,
        provider: deployConfigDraft.provider,
        config: parsedConfig,
      });
      setDeployConfigModalOpen(false);
      setDeployConfigRepository(null);
      await refresh();
      toast.success('仓库部署模板已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存部署配置失败');
    } finally {
      setDeployConfigSaving(false);
    }
  }

  async function deleteRepository(workspaceId: string, repository: Repository) {
    const confirmed = window.confirm(`确认删除代码库“${repository.name}”吗？这会移除工作区中的仓库记录和本地副本。`);
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
    if (!repositoryEditDraft.name.trim()) {
      toast.error('请输入代码库名称');
      return;
    }
    await updateRepositoryMeta({
      name: repositoryEditDraft.name.trim(),
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
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="workspace-name">工作区名称</label>
              <UiInput
                id="workspace-name"
                value={workspaceDraft.name}
                onChange={(event) => setWorkspaceDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：FlowX 平台"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="workspace-description">描述</label>
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
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-name">代码库名称</label>
              <UiInput
                id="repository-name"
                value={repositoryDraft.name}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：flowx-web"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-url">仓库地址</label>
              <UiInput
                id="repository-url"
                value={repositoryDraft.url}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://github.com/org/repo"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-default-branch">默认分支</label>
              <UiInput
                id="repository-default-branch"
                value={repositoryDraft.defaultBranch}
                onChange={(event) => setRepositoryDraft((current) => ({ ...current, defaultBranch: event.target.value }))}
                placeholder="main / master / develop"
              />
            </div>
            <UiButton type="submit">添加代码库</UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editRepositoryModalOpen}
        onOpenChange={(open) => {
          setEditRepositoryModalOpen(open);
          if (!open) {
            setEditingRepositoryMeta(null);
            setRepositoryEditDraft({ name: '', defaultBranch: '' });
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑代码库</DialogTitle>
            <DialogDescription>维护代码库名称和默认分支，不会自动切换当前分支。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleUpdateRepositoryMeta(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-edit-name">代码库名称</label>
              <UiInput
                id="repository-edit-name"
                value={repositoryEditDraft.name}
                onChange={(event) => setRepositoryEditDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：flowx-web"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-edit-default-branch">默认分支</label>
              <UiInput
                id="repository-edit-default-branch"
                value={repositoryEditDraft.defaultBranch}
                onChange={(event) => setRepositoryEditDraft((current) => ({ ...current, defaultBranch: event.target.value }))}
                placeholder="main / master / develop"
              />
            </div>
            <DialogFooter className="border-t border-slate-200 pt-4">
              <UiButton
                type="submit"
                className="min-w-[140px] bg-slate-900 text-white hover:bg-slate-800"
              >
                保存代码库信息
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
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-current-branch">当前分支</label>
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
      <Dialog
        open={deployConfigModalOpen}
        onOpenChange={(open) => {
          setDeployConfigModalOpen(open);
          if (!open) {
            setDeployConfigRepository(null);
            setDeployConfigDraft({ enabled: false, provider: 'noop', configText: '{}' });
            setDeployConfigSaving(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>仓库部署配置</DialogTitle>
            <DialogDescription>
              模板跟着仓库走。这里维护仓库对应的 CI/CD provider 和默认发布参数，工作流完成后再按仓库触发部署。
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void saveDeployConfig(event)}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              当前仓库：{deployConfigRepository?.repository.name ?? '未选择'}。推荐把 `env / ops / k8s_name / project_name / jenkins / id / folder` 这些默认值维护在这里。
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={deployConfigDraft.enabled}
                onChange={(event) => setDeployConfigDraft((current) => ({ ...current, enabled: event.target.checked }))}
              />
              启用该仓库的部署模板
            </label>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]">Deploy Provider</label>
              <Select
                value={deployConfigDraft.provider}
                onValueChange={(value) => setDeployConfigDraft((current) => ({ ...current, provider: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择部署 Provider" />
                </SelectTrigger>
                <SelectContent>
                  {deployProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="repository-deploy-config">部署模板 JSON</label>
              <Textarea
                id="repository-deploy-config"
                rows={16}
                spellCheck={false}
                value={deployConfigDraft.configText}
                onChange={(event) => setDeployConfigDraft((current) => ({ ...current, configText: event.target.value }))}
                placeholder='{"env":"dev","ops":"prod"}'
              />
            </div>
            <DialogFooter className="border-t border-slate-200 pt-4">
              <UiButton type="submit" disabled={deployConfigSaving}>
                {deployConfigSaving ? '保存中...' : '保存部署模板'}
              </UiButton>
            </DialogFooter>
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
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : workspaces.length > 0 ? (
            <div className="record-list-stack">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className="border-b border-slate-200 py-4 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-base font-semibold leading-6 text-slate-950">{workspace.name}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{workspace.description || '未填写描述'}</p>
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
                            <UiButton
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingRepositoryMeta({ workspaceId: workspace.id, repository });
                                setRepositoryEditDraft({
                                  name: repository.name,
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
                              onClick={() => void openDeployConfig(workspace.id, repository)}
                              disabled={deployConfigLoading}
                            >
                              部署配置
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
