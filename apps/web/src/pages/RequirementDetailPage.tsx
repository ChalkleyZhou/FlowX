import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useConfirm } from '../components/ConfirmDialog';
import { ContextPanel } from '../components/ContextPanel';
import { DetailHeader } from '../components/DetailHeader';
import { PrototypeImportPanel } from '../components/PrototypeImportPanel';
import { RequirementEditDialog } from '../components/RequirementEditDialog';
import { RequirementSchedulingPanel } from '../components/RequirementSchedulingPanel';
import { RequirementChangesPanel } from '../components/RequirementChangesPanel';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import type { ProjectVersionSummary, Requirement } from '../types';
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';
import { formatRequirementWorkflowScope, getActiveRequirementWorkflows, isActiveRequirementWorkflow } from '../utils/requirement-workflows';
import { formatWorkflowStatus } from '../utils/workflow-ui';

function RequirementDetailField({ label, value }: { label: string; value?: string | null }) {
  const text = value?.trim() ?? '';
  const url = /^https?:\/\/\S+$/i.test(text) ? text : null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      {url ? (
        <a className="break-all text-sm leading-6 text-primary underline" href={url} target="_blank" rel="noreferrer">{url}</a>
      ) : (
        <p className="whitespace-pre-line text-sm leading-6 text-foreground">{text || '未填写'}</p>
      )}
    </div>
  );
}

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editVersions, setEditVersions] = useState<ProjectVersionSummary[]>([]);
  const [changesRefresh, setChangesRefresh] = useState<string | undefined>();
  const requestVersion = useRef(0);

  const fetchRequirement = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!id) {
      return;
    }
    const version = ++requestVersion.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await api.getRequirement(id);
      if (version === requestVersion.current) {
        setRequirement(data);
      }
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : '加载需求失败，请重试');
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    void fetchRequirement();
    return () => { requestVersion.current += 1; };
  }, [fetchRequirement]);

  useEffect(() => {
    if (window.location.hash === '#scheduling') {
      document.getElementById('scheduling')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [requirement, loading]);

  async function openEdit() {
    if (!requirement) return;
    try {
      const project = await api.getProject(requirement.project.id);
      setEditVersions(project.versions ?? []);
    } catch {
      setEditVersions(requirement.version ? [requirement.version] : []);
    }
    setEditOpen(true);
  }

  async function handleDelete() {
    if (!requirement || deleting) return;
    const confirmed = await confirm({
      title: '删除需求',
      description: `删除后将移除「${requirement.title}」及其工作流、构思记录、排期和原型材料。关联的缺陷与问题会保留，但不再指向这条需求。已纳入测试设计或提测时需要先解除关联。确认删除吗？`,
      confirmLabel: '删除需求',
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.deleteRequirement(requirement.id);
      toast.success('需求已删除');
      navigate('/requirements');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除需求失败');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (error || !requirement) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col gap-3 p-5">
          <p role="alert" className="text-sm text-muted-foreground">{error ?? '需求未找到'}</p>
          <div className="flex gap-3">
            <Button onClick={() => void fetchRequirement()}>重试</Button>
            <Button variant="outline" asChild><Link to="/requirements">返回列表</Link></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeWorkflows = getActiveRequirementWorkflows(requirement);
  const historicalWorkflows = (requirement.workflowRuns ?? []).filter((run) => !isActiveRequirementWorkflow(run));
  const launchParams = new URLSearchParams({ projectId: requirement.project.id, launchRequirementId: requirement.id });

  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        eyebrow="Requirement"
        title={requirement.title}
        description={requirement.description}
        badges={[
          { key: 'project', label: requirement.project?.name ?? '', variant: 'default' },
          {
            key: 'planning',
            label: formatPlanningStatus(requirement.planningStatus),
            variant: 'outline',
          },
          {
            key: 'priority',
            label: formatPriority(requirement.priority),
            variant: 'secondary',
          },
          ...(requirement.version
            ? [{ key: 'version', label: requirement.version.name, variant: 'outline' as const }]
            : []),
        ]}
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <Link to="/requirements">返回列表</Link>
            </Button>
            <Button variant="outline" type="button" onClick={() => void openEdit()}>编辑</Button>
            <Button variant="outline" type="button" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? '删除中...' : '删除需求'}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/requirements/${requirement.id}#scheduling`}>排期</Link>
            </Button>
            {activeWorkflows.length === 1 ? (
              <Button asChild><Link to={`/workflow-runs/${activeWorkflows[0].id}`}>继续当前工作流</Link></Button>
            ) : activeWorkflows.length > 1 ? (
              <Button asChild><a href="#active-workflows">选择要继续的工作流</a></Button>
            ) : null}
            {(!requirement.prototypeImport || requirement.prototypeImport.status === 'CONFIRMED') && <Button variant={activeWorkflows.length > 0 ? 'outline' : 'default'} asChild>
              <Link to={`/requirements?${launchParams.toString()}`}>
                {activeWorkflows.length > 0 ? '启动其他仓库工作流' : '启动研发工作流'}
              </Link>
            </Button>}
          </div>
        )}
      />

      {requirement.prototypeImport && <PrototypeImportPanel
        importId={requirement.prototypeImport.id}
        existingWorkflowId={activeWorkflows.length === 1 ? activeWorkflows[0].id : undefined}
        onConfirmed={() => {
          setChangesRefresh(String(Date.now()));
          return fetchRequirement({ silent: true });
        }}
      />}

      <RequirementChangesPanel requirementId={requirement.id} refreshKey={changesRefresh} onChanged={() => fetchRequirement({ silent: true })} />

      <section id="active-workflows" className="scroll-mt-5">
        <ContextPanel
          eyebrow="Workflow"
          title={activeWorkflows.length > 1 ? '选择要继续的工作流' : '当前工作流'}
          description={activeWorkflows.length > 0 ? '按仓库范围继续已有流程；需要并行推进其他仓库时，可另行启动。' : requirement.prototypeImport?.status !== undefined && requirement.prototypeImport.status !== 'CONFIRMED' ? '原型导入完成后自动接入研发流程，失败可在上方重试。' : '当前没有活跃工作流，可以选择仓库和执行器后启动。'}
        >
          <div className="flex flex-col gap-3">
            {activeWorkflows.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{run.supersededByChangeId ? '已由需求变更替代' : formatWorkflowStatus(run.status)} · {run.id.slice(-6)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">仓库范围：{formatRequirementWorkflowScope(run)}</p>
                </div>
                <Button variant="outline" asChild><Link to={`/workflow-runs/${run.id}`}>继续此工作流</Link></Button>
              </div>
            ))}
          </div>
        </ContextPanel>
      </section>

      {historicalWorkflows.length > 0 ? (
        <ContextPanel eyebrow="History" title="历史工作流" description="已完成或失败的流程，可进入查看历史产物与记录。">
          <div className="flex flex-col gap-3">
            {historicalWorkflows.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{run.supersededByChangeId ? '已由需求变更替代' : formatWorkflowStatus(run.status)} · {run.id.slice(-6)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">仓库范围：{formatRequirementWorkflowScope(run)}</p>
                </div>
                <Button variant="outline" asChild><Link to={`/workflow-runs/${run.id}`}>查看历史</Link></Button>
              </div>
            ))}
          </div>
        </ContextPanel>
      ) : null}

      <ContextPanel
        eyebrow="Requirement"
        title="需求详情"
        description="验收标准与创建时补充的档案。风险与影响、产品需求文档只在这里查看。"
      >
        <div className="flex flex-col gap-4">
          <RequirementDetailField label="验收标准" value={requirement.acceptanceCriteria} />
          <RequirementDetailField label="功能模块" value={requirement.functionalModule} />
          <RequirementDetailField label="风险&影响" value={requirement.riskImpact} />
          <RequirementDetailField label="产品需求文档" value={requirement.productRequirementDocument} />
          <RequirementDetailField label="备注" value={requirement.remark} />
        </div>
      </ContextPanel>

      <RequirementSchedulingPanel requirement={requirement} onChanged={() => fetchRequirement()} />
      <RequirementEditDialog
        requirement={requirement}
        versions={editVersions}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          setRequirement((current) => (current ? { ...current, ...updated } : updated));
          setEditOpen(false);
        }}
      />
    </div>
  );
}
