import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ONLINE_AI_UNAVAILABLE_MESSAGE, useOnlineAiProviders } from '../online-ai';
import { PageHeader } from '../components/PageHeader';
import { ProjectBriefingConfigPanel } from '../components/ProjectBriefingConfigPanel';
import { ProjectCodeReviewConfigPanel } from '../components/ProjectCodeReviewConfigPanel';
import { ProjectVersionsPanel } from '../components/ProjectVersionsPanel';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { Project, ProjectVersionSummary } from '../types';
import { formatAssignmentSummary, formatScheduleRange } from '../utils/business-days';
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [versionFilter, setVersionFilter] = useState('__all__');
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createVersion, setCreateVersion] = useState<ProjectVersionSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const createFileInput = useRef<HTMLInputElement>(null);
  const createInFlight = useRef(false);
  const onlineAi = useOnlineAiProviders();

  async function createRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createInFlight.current || !projectId || !createVersion) return;
    const title = createTitle.trim();
    if (!title) {
      toast.error('请填写需求标题');
      return;
    }
    if (createFile && (!/\.zip$/i.test(createFile.name) || createFile.size > 20 * 1024 * 1024)) {
      setCreateError('请选择不超过 20 MiB 的 ZIP 文件');
      return;
    }
    createInFlight.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      if (createFile) {
        if (onlineAi && !onlineAi.onlineAvailable) {
          setCreateError(ONLINE_AI_UNAVAILABLE_MESSAGE);
          return;
        }
        const imported = await api.createPrototypeImport({
          projectId, title, versionId: createVersion.id,
          ...(onlineAi?.defaultProvider ? { aiProvider: onlineAi.defaultProvider } : {}),
        }, createFile);
        navigate(`/requirements/${imported.requirementId}?importing=1`);
        return;
      }
      await api.createRequirement({ projectId, title, versionId: createVersion.id });
      setCreateOpen(false);
      setCreateTitle('');
      setVersionFilter(createVersion.id);
      await refresh();
      toast.success('需求创建成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建需求失败';
      setCreateError(message);
      toast.error(message);
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  async function refresh() {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      setProject(await api.getProject(projectId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载项目失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const filteredRequirements = useMemo(() => {
    const rows = project?.requirements ?? [];
    if (versionFilter === '__all__') {
      return rows;
    }
    if (versionFilter === '__unversioned__') {
      return rows.filter((requirement) => !requirement.versionId);
    }
    return rows.filter((requirement) => requirement.versionId === versionFilter);
  }, [project?.requirements, versionFilter]);

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">缺少项目 ID。</p>;
  }

  if (loading && !project) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-muted-foreground">项目不存在或无法加载。</p>;
  }

  return (
    <>
      <Dialog open={createOpen} onOpenChange={(open) => { if (!createInFlight.current) setCreateOpen(open); }}>
        <DialogContent onEscapeKeyDown={(event) => { if (creating) event.preventDefault(); }} onPointerDownOutside={(event) => { if (creating) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>新建需求</DialogTitle>
            <DialogDescription>
              {createVersion ? `${project.name} · 当前版本 ${createVersion.name}。填写标题即可；也可附上原型 ZIP，由 AI 整理需求与设计。` : '请先设置项目当前版本，再快速新建需求。'}
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void createRequirement(event)}>
            <label className="flex flex-col gap-2 text-sm font-semibold" htmlFor="quick-requirement-title">
              需求标题
              <Input id="quick-requirement-title" required maxLength={1000} autoFocus value={createTitle} disabled={creating || !createVersion} onChange={(event) => setCreateTitle(event.target.value)} placeholder="例如：优化需求创建体验" />
            </label>
            <div className="flex flex-col gap-2">
              <label htmlFor="quick-requirement-zip" className="text-sm font-semibold">原型 ZIP（选填）</label>
              <Input ref={createFileInput} id="quick-requirement-zip" type="file" accept=".zip,application/zip" disabled={creating || !createVersion} onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setCreateFile(file);
                setCreateError(file && (!/\.zip$/i.test(file.name) || file.size > 20 * 1024 * 1024) ? '请选择不超过 20 MiB 的 ZIP 文件' : null);
              }} />
              <p className="text-xs text-muted-foreground">最大 20 MiB。上传后自动整理并接入研发流程，无需确认；不上传则直接创建。</p>
              {createFile && <Button type="button" size="sm" variant="outline" className="self-start" disabled={creating} onClick={() => {
                setCreateFile(null); setCreateError(null);
                if (createFileInput.current) createFileInput.current.value = '';
              }}>移除 ZIP</Button>}
            </div>
            {createError && <p role="alert" className="text-sm text-danger">{createError}</p>}
            <div className="flex justify-end gap-2">
              {!createVersion && <Button variant="outline" asChild><a href="#project-versions" onClick={() => setCreateOpen(false)}>去设置当前版本</a></Button>}
              {createFile && onlineAi && !onlineAi.onlineAvailable ? <p role="status" className="text-sm text-muted-foreground">{ONLINE_AI_UNAVAILABLE_MESSAGE}</p> : null}
              <Button type="submit" disabled={creating || !createVersion || (!!createFile && onlineAi !== null && !onlineAi.onlineAvailable)}>{creating ? createFile ? '上传整理中…' : '创建中…' : createFile ? '上传原型，AI 整理' : '创建需求'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={project.description?.trim() || '管理项目下的需求与人员排期。'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to={`/schedule?projectId=${projectId}`}>在排期中查看</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/projects">返回项目列表</Link>
            </Button>
          </div>
        )}
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Badge variant="outline">{project.workspace.name}</Badge>
        {project.code ? <Badge variant="secondary">{project.code}</Badge> : null}
        {project.currentVersion ? <Badge variant="secondary">{project.currentVersion.name}</Badge> : null}
        <Badge variant="default">{project.requirements?.length ?? 0} 条需求</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ProjectBriefingConfigPanel projectId={projectId} />
        <ProjectCodeReviewConfigPanel projectId={projectId} />
      </div>

      <div id="project-versions" className="mt-5 scroll-mt-5">
        <ProjectVersionsPanel
          projectId={projectId}
          currentVersionId={project.currentVersionId}
          onChanged={refresh}
        />
      </div>

      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeader eyebrow="Requirements" title="需求列表" />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={versionFilter} onValueChange={setVersionFilter}>
                <SelectTrigger className="w-44" aria-label="按版本筛选">
                  <SelectValue placeholder="全部版本" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部版本</SelectItem>
                  <SelectItem value="__unversioned__">未挂版本</SelectItem>
                  {(project.versions ?? []).map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {version.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => {
                setCreateTitle('');
                setCreateFile(null);
                setCreateError(null);
                setCreateVersion(project.currentVersion ?? null);
                setCreateOpen(true);
              }}>新建需求</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {filteredRequirements.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">需求</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">排期状态</th>
                    <th className="px-4 py-3 font-medium">优先级</th>
                    <th className="px-4 py-3 font-medium">人员</th>
                    <th className="px-4 py-3 font-medium">周期</th>
                    <th className="px-4 py-3 font-medium">人天</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequirements.map((requirement) => (
                    <tr key={requirement.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          to={`/requirements/${requirement.id}`}
                          className="text-foreground no-underline hover:text-primary"
                        >
                          {requirement.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{requirement.version?.name ?? ''}</td>
                      <td className="px-4 py-3">{formatPlanningStatus(requirement.planningStatus)}</td>
                      <td className="px-4 py-3">{formatPriority(requirement.priority)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatAssignmentSummary(requirement.assignments)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatScheduleRange(
                          requirement.scheduleSummary?.scheduleStart,
                          requirement.scheduleSummary?.scheduleEnd,
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {requirement.scheduleSummary?.totalEstimatedDays ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="default" size="sm" asChild>
                            <Link to={`/requirements/${requirement.id}`}>详情</Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/requirements/${requirement.id}#scheduling`}>排期</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">该项目下还没有需求。</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
