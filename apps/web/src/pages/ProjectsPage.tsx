import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ListToolbar } from '../components/ListToolbar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
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
import type { Project, Workspace } from '../types';

export function ProjectsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    workspaceId: '',
    name: '',
    code: '',
    description: '',
  });
  const toast = useToast();

  const filteredProjects = useMemo(() => {
    if (!selectedWorkspaceId) {
      return projects;
    }
    return projects.filter((project) => project.workspace.id === selectedWorkspaceId);
  }, [projects, selectedWorkspaceId]);

  const summary = useMemo(
    () => ({
      total: projects.length,
      visible: filteredProjects.length,
      workspaceCount: new Set(projects.map((project) => project.workspace.id)).size,
      requirementCount: filteredProjects.reduce(
        (sum, project) => sum + (project._count?.requirements ?? 0),
        0,
      ),
    }),
    [filteredProjects, projects],
  );

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, projectList] = await Promise.all([
        api.getWorkspaces(),
        api.getProjects(),
      ]);
      setWorkspaces(workspaceList);
      setProjects(projectList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载项目失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createDraft.workspaceId || !createDraft.name.trim()) {
      toast.error('请选择工作区并填写项目名称');
      return;
    }

    try {
      await api.createProject({
        workspaceId: createDraft.workspaceId,
        name: createDraft.name.trim(),
        code: createDraft.code.trim() || undefined,
        description: createDraft.description.trim() || undefined,
      });
      setCreateDraft({ workspaceId: '', name: '', code: '', description: '' });
      setSelectedWorkspaceId(createDraft.workspaceId);
      setCreateModalOpen(false);
      await refresh();
      toast.success('项目创建成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建项目失败');
    }
  }

  return (
    <>
      <Dialog
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) {
            setCreateDraft({ workspaceId: '', name: '', code: '', description: '' });
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建项目</DialogTitle>
            <DialogDescription>把真实的交付单元从工作区里提炼出来，作为需求归属的新层级。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateProject(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">所属工作区</label>
              <Select
                value={createDraft.workspaceId || undefined}
                onValueChange={(value) => setCreateDraft((current) => ({ ...current, workspaceId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择项目所在工作区" />
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
              <label className="text-sm font-semibold text-foreground" htmlFor="project-name">项目名称</label>
              <UiInput
                id="project-name"
                value={createDraft.name}
                onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：FlowX 控制台重构"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="project-code">项目代号</label>
              <UiInput
                id="project-code"
                value={createDraft.code}
                onChange={(event) => setCreateDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder="例如：FLOWX-CONSOLE"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="project-description">描述</label>
              <Textarea
                id="project-description"
                rows={4}
                value={createDraft.description}
                onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="说明这个项目服务的业务目标或交付范围。"
              />
            </div>
            <UiButton type="submit">创建项目</UiButton>
          </form>
        </DialogContent>
      </Dialog>

      <PageHeader
        eyebrow="Projects"
        title="项目池"
        description="项目现在作为工作区和需求之间的新层级，用来承接真实的交付单元和并行上下文。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="项目总数" value={summary.total} />
        <MetricCard label="当前筛选结果" value={summary.visible} />
        <MetricCard label="涉及工作区" value={summary.workspaceCount} />
        <MetricCard label="需求数量" value={summary.requirementCount} />
      </div>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Projects"
            title="项目列表"
            extra={<UiButton onClick={() => setCreateModalOpen(true)}>新增项目</UiButton>}
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <ListToolbar
            filters={(
              <Select
                value={selectedWorkspaceId ?? '__all__'}
                onValueChange={(value) => setSelectedWorkspaceId(value === '__all__' ? undefined : value)}
              >
                <SelectTrigger className="w-[220px]">
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
            )}
          />
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {filteredProjects.map((project) => (
                <RecordListItem
                  key={project.id}
                  title={<div className="text-base font-semibold leading-6 text-foreground">{project.name}</div>}
                  badges={
                    <>
                      <Badge variant="outline">{project.workspace.name}</Badge>
                      {project.code ? <Badge variant="secondary">{project.code}</Badge> : null}
                      <Badge variant="default">{project._count?.requirements ?? 0} 条需求</Badge>
                    </>
                  }
                  details={
                    <p className="text-sm leading-6 text-muted-foreground">
                      {project.description?.trim() || '这个项目还没有补充描述。'}
                    </p>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState description="当前还没有项目，可先从某个工作区下创建。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
