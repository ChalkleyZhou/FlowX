import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { FilterBar } from '../components/FilterBar';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import type { Requirement, Workspace } from '../types';

export function RequirementsPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    workspaceId: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
  });
  const toast = useToast();

  const filteredRequirements = useMemo(() => {
    if (!selectedWorkspaceId) {
      return requirements;
    }
    return requirements.filter((item) => item.workspace?.id === selectedWorkspaceId);
  }, [requirements, selectedWorkspaceId]);

  const requirementSummary = useMemo(() => {
    const workspaceSet = new Set(requirements.map((item) => item.workspace?.id).filter(Boolean));
    return {
      requirementCount: requirements.length,
      visibleCount: filteredRequirements.length,
      workspaceCount: workspaceSet.size,
    };
  }, [filteredRequirements.length, requirements]);

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, requirementList] = await Promise.all([
        api.getWorkspaces(),
        api.getRequirements(),
      ]);
      setWorkspaces(workspaceList);
      setRequirements(requirementList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载需求失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createRequirement(values: {
    workspaceId: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  }) {
    try {
      await api.createRequirement(values);
      setCreateDraft({
        workspaceId: '',
        title: '',
        description: '',
        acceptanceCriteria: '',
      });
      setCreateModalOpen(false);
      setSelectedWorkspaceId(values.workspaceId);
      await refresh();
      toast.success('需求创建成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建需求失败');
    }
  }

  async function startWorkflow(requirementId: string) {
    try {
      const run = await api.createWorkflowRun(requirementId);
      toast.success('工作流已启动');
      navigate(`/workflow-runs/${run.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动工作流失败');
    }
  }

  async function handleCreateRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createDraft.workspaceId) {
      toast.error('请选择工作区');
      return;
    }

    if (!createDraft.title.trim() || !createDraft.description.trim() || !createDraft.acceptanceCriteria.trim()) {
      toast.error('请完整填写需求信息');
      return;
    }

    await createRequirement({
      workspaceId: createDraft.workspaceId,
      title: createDraft.title.trim(),
      description: createDraft.description.trim(),
      acceptanceCriteria: createDraft.acceptanceCriteria.trim(),
    });
  }

  return (
    <>
      <Dialog
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) {
            setCreateDraft({
              workspaceId: '',
              title: '',
              description: '',
              acceptanceCriteria: '',
            });
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建需求</DialogTitle>
            <DialogDescription>填写基础信息后，这条需求就可以归档到工作区并发起工作流。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateRequirement(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]">所属工作区</label>
              <Select
                value={createDraft.workspaceId || undefined}
                onValueChange={(value) => setCreateDraft((current) => ({ ...current, workspaceId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择需求属于哪个项目" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-title">需求标题</label>
              <UiInput
                id="requirement-title"
                value={createDraft.title}
                onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="AI研发调度系统 MVP"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-description">需求描述</label>
              <Textarea
                id="requirement-description"
                rows={4}
                value={createDraft.description}
                onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="描述产品目标、范围和约束边界。"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-acceptance">验收标准</label>
              <Textarea
                id="requirement-acceptance"
                rows={4}
                value={createDraft.acceptanceCriteria}
                onChange={(event) => setCreateDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
                placeholder="列出本次迭代必须满足的验收检查点。"
              />
            </div>
            <UiButton type="submit" className="mt-2">
              创建需求
            </UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Requirements"
        title="需求录入与流程发起"
        description="先归档需求，再基于所属工作区发起工作流，让需求、代码仓库与执行历史保持同一条上下文链路。"
      />
      <div className="grid gap-5 md:grid-cols-3">
        <MetricCard label="需求总数" value={requirementSummary.requirementCount} />
        <MetricCard label="当前筛选结果" value={requirementSummary.visibleCount} />
        <MetricCard label="涉及工作区" value={requirementSummary.workspaceCount} />
      </div>
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Requirement Pool"
            title="需求列表"
            extra={
              <FilterBar className="border-0 bg-transparent p-0">
                <Select
                  value={selectedWorkspaceId ?? '__all__'}
                  onValueChange={(value) => setSelectedWorkspaceId(value === '__all__' ? undefined : value)}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="按工作区筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部工作区</SelectItem>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <UiButton onClick={() => setCreateModalOpen(true)}>
                  新增需求
                </UiButton>
              </FilterBar>
            }
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredRequirements.length > 0 ? (
            <div className="record-list-stack">
            {filteredRequirements.map((item) => (
              <RecordListItem
                key={item.id}
                title={<div className="text-base font-semibold leading-6 text-slate-950">{item.title}</div>}
                badges={
                  <Badge variant="default">
                    {item.workspace?.name ?? '未绑定工作区'}
                  </Badge>
                }
                description={<p className="leading-6">{item.description}</p>}
                details={<p className="text-sm leading-6 text-slate-500">{item.acceptanceCriteria}</p>}
                actions={
                  <>
                    <UiButton variant="outline" onClick={() => void startWorkflow(item.id)}>
                      启动工作流
                    </UiButton>
                    <UiButton variant="outline" onClick={() => navigate(`/workflow-runs?requirementId=${item.id}`)}>
                      查看流程
                    </UiButton>
                  </>
                }
              />
            ))}
            </div>
          ) : (
            <EmptyState description="还没有录入任何需求，先创建一条需求开始推进。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
