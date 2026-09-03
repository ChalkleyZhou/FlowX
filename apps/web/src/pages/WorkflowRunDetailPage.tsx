import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, getFlowxApiBaseUrl } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { OpenDesignLaunchGuideDialog } from '../components/OpenDesignLaunchGuideDialog';
import { DesignArtifactPreview } from '../components/DesignArtifactPreview';
import { DesignDocumentPanel } from '../components/DesignDocumentPanel';
import { DiffFileListPanel } from '../components/DiffFileListPanel';
import { DiffViewerPanel } from '../components/DiffViewerPanel';
import { EmptyState } from '../components/EmptyState';
import { DetailHeader } from '../components/DetailHeader';
import { ExecutionSessionPanel } from '../components/ExecutionSessionPanel';
import { MetricCard } from '../components/MetricCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatPill } from '../components/StatPill';
import { SpecPlanDocumentPanel } from '../components/SpecPlanDocumentPanel';
import { StageCard } from '../components/StageCard';
import { ReviewFindingCard } from '../components/ReviewFindingCard';
import {
  WorkflowReviewSidebar,
  type WorkflowSidebarMode,
  type WorkflowWorkspaceAction,
} from '../components/WorkflowReviewSidebar';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea as UiTextarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ConfirmDialog';
import {
  launchFlowxLocal,
  launchOpenDesignLocal,
  probeFlowxLocal,
  submitOpenDesignLocal,
  type FlowxLocalLaunchBody,
} from '../lib/flowx-local-bridge';
import type {
  ExecutionSessionDetail,
  ExecutionSessionEvidence,
  ExecutionSessionSyncEvent,
  LocalHandoffPayload,
  WorkflowRun,
} from '../types';
import {
  formatStageExecutionStatus,
  formatWorkflowRunType,
  formatWorkflowStatus,
  getStage,
} from '../utils/workflow-ui';
import { parseSpecPlanOutput, serializeSpecPlanOutput } from '../utils/spec-plan';

const STAGE_SEQUENCE = [
  'REPOSITORY_GROUNDING',
  'BRAINSTORM',
  'DESIGN',
  'SPEC_PLAN',
  'EXECUTION',
  'AI_REVIEW',
  'HUMAN_REVIEW',
] as const;

type WorkflowStageKey = (typeof STAGE_SEQUENCE)[number];
type EditableStage = 'spec-plan' | 'execution' | 'review';

interface StageActionView {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface WorkflowWorkspaceConfig {
  stage: EditableStage;
  title: string;
  helperText: string;
  statusLabel?: string;
  feedbackPlaceholder: string;
  primaryAction: WorkflowWorkspaceAction;
  secondaryActions: WorkflowWorkspaceAction[];
}

interface StageDetailView {
  title: string;
  subtitle: string;
  status?: string;
  statusMessage?: string | null;
  attempt?: number;
  output?: unknown;
  actions: StageActionView[];
}

interface DiffArtifactView {
  repository: string;
  branch: string;
  localPath: string;
  diffStat: string;
  diffText: string;
  untrackedFiles: string[];
}

interface DiffFileView {
  key: string;
  path: string;
  kind: 'modified' | 'untracked';
  diffText: string;
}

interface RepositoryPathContext {
  name: string;
  localPath?: string | null;
}

interface PublishRepositorySummary {
  repository: string;
  branch: string;
  commitSha: string;
  pushed: boolean;
  verified: boolean;
  remoteUrl: string;
}

function isLocalExecutionActive(workflowRun: WorkflowRun): boolean {
  const executionStage = getStage(workflowRun, 'EXECUTION');
  const input = executionStage?.input;
  return (
    workflowRun.status === 'EXECUTION_RUNNING' &&
    !!input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).executor === 'LOCAL'
  );
}

const stageMeta: Record<
  WorkflowStageKey,
  { title: string; stepLabel: string; stageNo: string; editableStage?: EditableStage }
> = {
  REPOSITORY_GROUNDING: {
    title: '仓库 Grounding',
    stepLabel: '仓库 Grounding',
    stageNo: '阶段 1',
  },
  BRAINSTORM: {
    title: '产品构思',
    stepLabel: '产品构思',
    stageNo: '阶段 2',
  },
  DESIGN: {
    title: '设计方案',
    stepLabel: '设计方案',
    stageNo: '阶段 3',
  },
  SPEC_PLAN: {
    title: 'Spec & Plan',
    stepLabel: 'Spec & Plan',
    stageNo: '阶段 4',
    editableStage: 'spec-plan',
  },
  EXECUTION: {
    title: '开发执行',
    stepLabel: '开发执行',
    stageNo: '阶段 5',
    editableStage: 'execution',
  },
  AI_REVIEW: {
    title: 'AI 审查',
    stepLabel: 'AI 审查',
    stageNo: '阶段 6',
    editableStage: 'review',
  },
  HUMAN_REVIEW: {
    title: '人工评审',
    stepLabel: '人工评审',
    stageNo: '阶段 7',
    editableStage: 'review',
  },
};

function buildWorkflowSnapshot(value: WorkflowRun | null) {
  return JSON.stringify(value);
}

function getStepVisualStatus(stageStatus?: string): 'wait' | 'process' | 'finish' | 'error' {
  switch (stageStatus) {
    case 'COMPLETED':
    case 'SKIPPED':
      return 'finish';
    case 'RUNNING':
    case 'WAITING_CONFIRMATION':
      return 'process';
    case 'FAILED':
    case 'REJECTED':
      return 'error';
    default:
      return 'wait';
  }
}

function getStepDescription(stage?: { status?: string; statusMessage?: string | null }) {
  if (!stage?.status) {
    return '尚未开始';
  }

  if ((stage.status === 'RUNNING' || stage.status === 'FAILED') && stage.statusMessage?.trim()) {
    return stage.statusMessage.trim();
  }

  return formatStageExecutionStatus(stage.status);
}

function inferFocusedStage(run: WorkflowRun): WorkflowStageKey {
  for (const stageKey of STAGE_SEQUENCE) {
    const stage = getStage(run, stageKey);
    if (stage?.status === 'RUNNING' || stage?.status === 'WAITING_CONFIRMATION' || stage?.status === 'FAILED') {
      return stageKey;
    }
  }

  if (run.status === 'REPOSITORY_GROUNDING_PENDING') {
    return 'REPOSITORY_GROUNDING';
  }

  if (run.status === 'BRAINSTORM_PENDING') {
    return 'BRAINSTORM';
  }

  if (run.status === 'DESIGN_PENDING') {
    return 'DESIGN';
  }

  if (run.status === 'DESIGN_WAITING_CONFIRMATION') {
    return 'DESIGN';
  }

  if (
    run.status === 'SPEC_PLAN_PENDING' ||
    run.status === 'SPEC_PLAN_WAITING_CONFIRMATION' ||
    run.status === 'SPEC_PLAN_CONFIRMED'
  ) {
    return 'SPEC_PLAN';
  }

  if (run.status === 'EXECUTION_PENDING' || run.status === 'EXECUTION_RUNNING' || run.status === 'REVIEW_PENDING') {
    return 'EXECUTION';
  }

  if (run.status === 'HUMAN_REVIEW_PENDING') {
    return 'HUMAN_REVIEW';
  }

  if (run.status === 'DONE') {
    return 'AI_REVIEW';
  }

  return 'SPEC_PLAN';
}

function getStageKeyForEditableStage(stage: EditableStage): WorkflowStageKey {
  switch (stage) {
    case 'spec-plan':
      return 'SPEC_PLAN';
    case 'execution':
      return 'EXECUTION';
    case 'review':
      return 'AI_REVIEW';
    default:
      return 'SPEC_PLAN';
  }
}

function splitDiffTextIntoFiles(diffText: string): DiffFileView[] {
  if (!diffText.trim()) {
    return [];
  }

  const chunks = diffText
    .split(/(?=^diff --git )/gm)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? `变更文件 ${index + 1}`;

    return {
      key: `modified-${path}-${index}`,
      path,
      kind: 'modified' as const,
      diffText: chunk,
    };
  });
}

function sanitizeDisplayPathString(value: string, repositories: RepositoryPathContext[]) {
  const text = value.trim();
  if (!text) {
    return text;
  }

  const normalizedText = text.replace(/\\/g, '/');

  const repoContexts = repositories
    .filter((repository) => repository.localPath)
    .map((repository) => ({
      name: repository.name,
      localPath: String(repository.localPath).replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .sort((a, b) => b.localPath.length - a.localPath.length);

  for (const repository of repoContexts) {
    if (normalizedText === repository.localPath || normalizedText.startsWith(`${repository.localPath}/`)) {
      const relativePath = normalizedText.slice(repository.localPath.length).replace(/^\/+/, '');
      if (!relativePath) {
        return repoContexts.length > 1 ? `${repository.name}:.` : '.';
      }
      return repoContexts.length > 1 ? `${repository.name}:${relativePath}` : relativePath;
    }
  }

  if (normalizedText.startsWith('/Users/') || normalizedText.startsWith('/tmp/') || /^[A-Za-z]:\//.test(normalizedText)) {
    return '已隐藏本地绝对路径';
  }

  return text;
}

function sanitizeDisplayValue(value: unknown, repositories: RepositoryPathContext[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayValue(item, repositories));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      if (key === 'localPath') {
        return acc;
      }
      acc[key] = sanitizeDisplayValue(entry, repositories);
      return acc;
    }, {});
  }

  if (typeof value === 'string') {
    return sanitizeDisplayPathString(value, repositories);
  }

  return value;
}

export function WorkflowRunDetailPage() {
  const { workflowRunId = '' } = useParams();
  const navigate = useNavigate();
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStage, setSelectedStage] = useState<WorkflowStageKey>('SPEC_PLAN');
  const [branchSummaryExpanded, setBranchSummaryExpanded] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<'feedback' | null>(null);
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [selectedDiffFileKey, setSelectedDiffFileKey] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [sidebarMode, setSidebarMode] = useState<WorkflowSidebarMode>('feedback');
  const [manualEditDraft, setManualEditDraft] = useState('');
  const [submittingManualEdit, setSubmittingManualEdit] = useState(false);
  const [designFeedback, setDesignFeedback] = useState('');
  const [designSubmitting, setDesignSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastPublishedRepositories, setLastPublishedRepositories] = useState<PublishRepositorySummary[]>([]);
  const [localHandoff, setLocalHandoff] = useState<LocalHandoffPayload | null>(null);
  const [executionSession, setExecutionSession] = useState<ExecutionSessionDetail | null>(null);
  const [executionEvidence, setExecutionEvidence] = useState<ExecutionSessionEvidence[]>([]);
  const [executionEvents, setExecutionEvents] = useState<ExecutionSessionSyncEvent[]>([]);
  const [executionSessionLoading, setExecutionSessionLoading] = useState(false);
  const [localLaunchOpen, setLocalLaunchOpen] = useState(false);
  const [localLaunchBusy, setLocalLaunchBusy] = useState(false);
  const [localLaunchSetupRequired, setLocalLaunchSetupRequired] = useState(false);
  const [openDesignBusy, setOpenDesignBusy] = useState(false);
  const [openDesignGuideKind, setOpenDesignGuideKind] = useState<'brainstorm' | 'design' | null>(null);
  const [executionHtml, setExecutionHtml] = useState<string | null>(null);
  const [completeLocalOpen, setCompleteLocalOpen] = useState(false);
  const [completeLocalPushed, setCompleteLocalPushed] = useState(true);
  const [completeLocalBusy, setCompleteLocalBusy] = useState(false);
  const [completeLocalReports, setCompleteLocalReports] = useState<
    Record<string, { headSha: string; changedFiles: string; patchSummary: string }>
  >({});
  const toast = useToast();
  const confirm = useConfirm();
  const lastWorkflowSnapshotRef = useRef<string>('');
  const hasInitializedStageSelectionRef = useRef(false);
  const syncedReviewReportIdRef = useRef<string | null>(null);
  const busyStageRef = useRef<string | null>(null);

  function focusWorkflowSidebarTextarea() {
    if (typeof document === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="workflow-review-sidebar-shell"] textarea',
      );
      textarea?.focus();
    });
  }

  function setWorkspaceMode(_mode: 'feedback') {
    setSidebarMode('feedback');
    focusWorkflowSidebarTextarea();
  }

  function openWorkspaceEditMode(stage: EditableStage) {
    setSelectedStage(getStageKeyForEditableStage(stage));
    if (stage === 'spec-plan' && workflowRun) {
      const currentOutput = parseSpecPlanOutput(getStage(workflowRun, 'SPEC_PLAN')?.output);
      setManualEditDraft(currentOutput ? serializeSpecPlanOutput(currentOutput) : '{\n  "spec": {},\n  "plan": {}\n}');
    }
    setSidebarMode('manual-edit');
    focusWorkflowSidebarTextarea();
  }

  async function refresh(options?: { silent?: boolean }) {
    if (!workflowRunId) {
      return null;
    }

    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const nextWorkflowRun = await api.getWorkflowRun(workflowRunId);
      const nextSnapshot = buildWorkflowSnapshot(nextWorkflowRun);

      if (nextSnapshot !== lastWorkflowSnapshotRef.current) {
        lastWorkflowSnapshotRef.current = nextSnapshot;
        setWorkflowRun(nextWorkflowRun);
      }

      return nextWorkflowRun;
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : '加载工作流失败');
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, [workflowRunId]);

  useEffect(() => {
    hasInitializedStageSelectionRef.current = false;
    syncedReviewReportIdRef.current = null;
  }, [workflowRunId]);

  useEffect(() => {
    if (!workflowRun) {
      return;
    }

    const suggestedStage = inferFocusedStage(workflowRun);
    if (!hasInitializedStageSelectionRef.current) {
      setSelectedStage(suggestedStage);
      hasInitializedStageSelectionRef.current = true;
      return;
    }

    const currentStage = getStage(workflowRun, selectedStage);

    if (!currentStage || currentStage.status === 'NOT_STARTED' || currentStage.status === undefined) {
      setSelectedStage(suggestedStage);
    }
  }, [workflowRun]);

  useEffect(() => {
    setFeedbackText('');
    setSubmittingAction(null);
    setSidebarMode('feedback');
    setManualEditDraft('');
    setSubmittingManualEdit(false);
  }, [selectedStage, workflowRun?.id]);

  const hasRunningStage = workflowRun?.stageExecutions.some((item) => item.status === 'RUNNING') ?? false;
  const canRollbackToPreviousStage = Boolean(
    workflowRun &&
      !hasRunningStage &&
      workflowRun.status !== 'CREATED' &&
      workflowRun.status !== 'REPOSITORY_GROUNDING_PENDING',
  );
  const stageActionsLocked = busyStage !== null || hasRunningStage;
  const localInstallCurl = `curl -fsSL ${window.location.origin}/install | bash`;
  const localInstallPs1 = `irm ${window.location.origin}/install.ps1 | iex`;
  const latestExecutionStage = workflowRun ? getStage(workflowRun, 'EXECUTION') : undefined;
  const latestReviewStage = workflowRun ? getStage(workflowRun, 'AI_REVIEW') : undefined;
  const hasStaleReviewResults =
    !!workflowRun?.reviewReport &&
    !!latestExecutionStage?.attempt &&
    ((latestReviewStage?.attempt ?? 0) < latestExecutionStage.attempt ||
      workflowRun.status === 'REVIEW_PENDING');

  useEffect(() => {
    const reviewReportId = workflowRun?.reviewReport?.id;

    if (!workflowRun || !reviewReportId || selectedStage !== 'AI_REVIEW' || workflowRun.status !== 'HUMAN_REVIEW_PENDING') {
      return;
    }

    if (workflowRun.reviewFindings.length > 0) {
      syncedReviewReportIdRef.current = reviewReportId;
      return;
    }

    if (syncedReviewReportIdRef.current === reviewReportId || hasRunningStage) {
      return;
    }

    syncedReviewReportIdRef.current = reviewReportId;
    setBusyFindingId(`sync:${reviewReportId}`);

    void api
      .syncReviewFindings(reviewReportId)
      .then(async () => {
        await refresh({ silent: true });
      })
      .catch((error) => {
        syncedReviewReportIdRef.current = null;
        toast.error(error instanceof Error ? error.message : '整理 AI 审查结果失败');
      })
      .finally(() => {
        setBusyFindingId(null);
      });
  }, [workflowRun, selectedStage, hasRunningStage]);
  const diffArtifacts = useMemo<DiffArtifactView[]>(
    () => ((workflowRun?.codeExecution?.diffArtifacts as DiffArtifactView[] | undefined) ?? []).filter(Boolean),
    [workflowRun],
  );
  const diffReviewData = useMemo(() => {
    return diffArtifacts.map((artifact, artifactIndex) => {
      const modifiedFiles = splitDiffTextIntoFiles(artifact.diffText);
      const untrackedFiles = (artifact.untrackedFiles ?? []).map((path, untrackedIndex) => ({
        key: `untracked-${path}-${untrackedIndex}`,
        path,
        kind: 'untracked' as const,
        diffText: `未跟踪文件\n\n${path}\n\n该文件尚未纳入 Git 版本控制，请在人工审查时确认是否需要保留。`,
      }));

      return {
        artifactKey: `${artifact.repository}-${artifact.branch}-${artifactIndex}`,
        ...artifact,
        files: [...modifiedFiles, ...untrackedFiles],
      };
    });
  }, [diffArtifacts]);
  const activeArtifact = useMemo(() => {
    return (
      diffReviewData.find((artifact) => artifact.artifactKey === selectedArtifactKey) ??
      diffReviewData[0] ??
      null
    );
  }, [diffReviewData, selectedArtifactKey]);
  const activeDiffFile = useMemo(() => {
    if (!activeArtifact) {
      return null;
    }

    return activeArtifact.files.find((item) => item.key === selectedDiffFileKey) ?? activeArtifact.files[0] ?? null;
  }, [activeArtifact, selectedDiffFileKey]);
  const workflowMetrics = useMemo(() => {
    if (!workflowRun) {
      return null;
    }

    const latestStages = STAGE_SEQUENCE.map((stageKey) => getStage(workflowRun, stageKey)).filter(Boolean);
    const completedStages = latestStages.filter((item) => item?.status === 'COMPLETED').length;
    const waitingStages = latestStages.filter((item) => item?.status === 'WAITING_CONFIRMATION').length;
    const findingsCount = workflowRun.reviewFindings.length;

    return {
      completedStages,
      waitingStages,
      findingsCount,
      repositoryCount: workflowRun.workflowRepositories.length,
    };
  }, [workflowRun]);
  const branchSummaryText = useMemo(() => {
    if (!workflowRun?.workflowRepositories.length) {
      return '';
    }

    const first = workflowRun.workflowRepositories[0];
    if (workflowRun.workflowRepositories.length === 1) {
      return `工作分支：${first.name} / ${first.workingBranch}`;
    }

    return `工作分支：${first.name} / ${first.workingBranch} 等 ${workflowRun.workflowRepositories.length} 个`;
  }, [workflowRun]);
  const selectedSpecPlanOutput = useMemo(
    () => (selectedStage === 'SPEC_PLAN' && workflowRun ? parseSpecPlanOutput(getStage(workflowRun, 'SPEC_PLAN')?.output) : null),
    [selectedStage, workflowRun],
  );

  const designStageSnapshot = workflowRun ? getStage(workflowRun, 'DESIGN') : undefined;
  const canReviseDesignSpec =
    !!workflowRun &&
    selectedStage === 'DESIGN' &&
    workflowRun.status === 'DESIGN_WAITING_CONFIRMATION' &&
    designStageSnapshot?.status === 'WAITING_CONFIRMATION' &&
    !stageActionsLocked;
  const isDesignFeedbackVisible =
    selectedStage === 'DESIGN' &&
    workflowRun?.status === 'DESIGN_WAITING_CONFIRMATION' &&
    designStageSnapshot?.status === 'WAITING_CONFIRMATION';


  const localExecutionActive = workflowRun ? isLocalExecutionActive(workflowRun) : false;

  useEffect(() => {
    if (!workflowRun?.id || !localExecutionActive) {
      setLocalHandoff(null);
      return;
    }

    let cancelled = false;

    void api
      .getLocalHandoff(workflowRun.id)
      .then((handoff) => {
        if (!cancelled) {
          setLocalHandoff(handoff);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalHandoff(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workflowRun?.id, localExecutionActive]);

  const executionSessionId =
    selectedStage === 'EXECUTION' ? localHandoff?.executionSessionId ?? null : null;

  const refreshExecutionSession = useCallback(async () => {
    if (!executionSessionId) {
      return;
    }

    setExecutionSessionLoading(true);
    try {
      const [session, evidence, eventsPage] = await Promise.all([
        api.getExecutionSession(executionSessionId),
        api.listExecutionSessionEvidence(executionSessionId),
        api.listExecutionSessionEvents(executionSessionId, { take: 10 }).catch(() => null),
      ]);
      setExecutionSession(session);
      setExecutionEvidence(evidence);
      setExecutionEvents(eventsPage?.items ?? []);
    } catch {
      setExecutionSession(null);
      setExecutionEvidence([]);
      setExecutionEvents([]);
    } finally {
      setExecutionSessionLoading(false);
    }
  }, [executionSessionId]);

  useEffect(() => {
    if (!executionSessionId) {
      setExecutionSession(null);
      setExecutionEvidence([]);
      setExecutionEvents([]);
      return;
    }

    void refreshExecutionSession();
    const interval = window.setInterval(() => void refreshExecutionSession(), 30_000);

    return () => window.clearInterval(interval);
  }, [executionSessionId, refreshExecutionSession]);

  const hasExecutionArtifact = useMemo(() => {
    if (selectedStage !== 'EXECUTION' || !workflowRun) {
      return false;
    }

    const output = getStage(workflowRun, 'EXECUTION')?.output;
    return Boolean(
      output &&
        typeof output === 'object' &&
        !Array.isArray(output) &&
        '_artifact' in output &&
        output._artifact,
    );
  }, [selectedStage, workflowRun]);

  useEffect(() => {
    if (!hasExecutionArtifact || !workflowRun?.id) {
      setExecutionHtml(null);
      return;
    }

    let cancelled = false;

    void api
      .fetchExecutionArtifact(workflowRun.id)
      .then((html) => {
        if (!cancelled) {
          setExecutionHtml(html);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExecutionHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasExecutionArtifact, workflowRun?.id]);

  useEffect(() => {
    if (!hasRunningStage) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [hasRunningStage, workflowRunId]);


  useEffect(() => {
    if (!activeArtifact) {
      setSelectedArtifactKey(null);
      setSelectedDiffFileKey(null);
      return;
    }

    if (selectedArtifactKey !== activeArtifact.artifactKey) {
      setSelectedArtifactKey(activeArtifact.artifactKey);
    }

    if (!activeDiffFile && activeArtifact.files[0]) {
      setSelectedDiffFileKey(activeArtifact.files[0].key);
      return;
    }

    if (activeDiffFile && selectedDiffFileKey !== activeDiffFile.key) {
      setSelectedDiffFileKey(activeDiffFile.key);
    }
  }, [activeArtifact, activeDiffFile, selectedArtifactKey, selectedDiffFileKey]);

  async function runAction(
    stage: string,
    action: () => Promise<unknown>,
    successText: string,
    options?: { focusNextStage?: boolean; allowWhileRunning?: boolean },
  ) {
    if (busyStageRef.current || (hasRunningStage && !options?.allowWhileRunning)) {
      return;
    }

    busyStageRef.current = stage;
    setBusyStage(stage);
    try {
      await action();
      const nextWorkflowRun = await refresh();
      if (options?.focusNextStage && nextWorkflowRun) {
        setSelectedStage(inferFocusedStage(nextWorkflowRun));
      }
      toast.success(successText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      busyStageRef.current = null;
      setBusyStage(null);
    }
  }

  async function submitCompleteLocalExecution() {
    if (!workflowRun || !localHandoff) {
      return;
    }

    setCompleteLocalBusy(true);
    try {
      const repositories = localHandoff.repositories.map((repository) => {
        const report = completeLocalReports[repository.workflowRepositoryId];
        return {
          workflowRepositoryId: repository.workflowRepositoryId,
          headSha: report?.headSha.trim() ?? '',
          changedFiles: (report?.changedFiles ?? '')
            .split('\n')
            .map((path) => path.trim())
            .filter(Boolean),
          patchSummary: report?.patchSummary?.trim() || undefined,
        };
      });

      await api.completeLocalExecution(workflowRun.id, {
        pushed: completeLocalPushed,
        repositories,
      });
      setCompleteLocalOpen(false);
      setLocalHandoff(null);
      await refresh();
      toast.success('本地执行已完成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '完成本地执行失败');
    } finally {
      setCompleteLocalBusy(false);
    }
  }

  async function launchLocalExecution(ide: FlowxLocalLaunchBody['ide']) {
    if (
      !workflowRun ||
      (workflowRun.status !== 'EXECUTION_PENDING' && !localExecutionActive) ||
      localLaunchBusy
    ) {
      return;
    }

    setLocalLaunchBusy(true);
    setLocalLaunchSetupRequired(false);
    try {
      if (workflowRun.status === 'EXECUTION_PENDING') {
        const result = await api.claimLocalExecution(workflowRun.id);
        setLocalHandoff(result.handoff);
        setWorkflowRun(result.workflow);
      }

      const { ticket, loopbackPort } = await api.issueLocalLaunchTicket(workflowRun.id);
      const daemonReachable = await probeFlowxLocal(loopbackPort);
      if (!daemonReachable) {
        setLocalLaunchSetupRequired(true);
        setLocalLaunchOpen(false);
        await refresh({ silent: true });
        toast.error('未检测到本机 flowx-local，请先完成本地安装（设置 → 本地 Agent）');
        return;
      }

      const result = await launchFlowxLocal(
        { ticket, ide, apiBaseUrl: getFlowxApiBaseUrl() },
        loopbackPort,
      );
      setLocalLaunchOpen(false);
      await refresh({ silent: true });
      toast.success(
        result.prefilled
          ? `已打开 ${ide === 'cursor' ? 'Cursor' : 'Codex'} 并预填执行上下文`
          : `已打开 ${ide === 'cursor' ? 'Cursor' : 'Codex'}；提示词文件已生成，内容已复制到剪贴板`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '本地启动失败');
    } finally {
      setLocalLaunchBusy(false);
    }
  }

  async function launchLocalOpenDesign() {
    if (!workflowRun || openDesignBusy) return;
    setOpenDesignBusy(true);
    try {
      const started = await api.retryOpenDesignHandoff(workflowRun.id);
      if (!(await probeFlowxLocal(started.loopbackPort))) {
        toast.error('未检测到本机 flowx-local，请先完成本地安装（设置 → 本地 Agent）');
        return;
      }
      const local = await launchOpenDesignLocal(
        { ticket: started.ticket, apiBaseUrl: getFlowxApiBaseUrl() },
        started.loopbackPort,
      );
      toast.success(
        local.opened
          ? '已打开 Open Design。请在应用内选择项目目录，并用 FlowX MCP 拉取上下文 / 回传设计。'
          : '设计会话已就绪。请打开 Open Design，用 FlowX MCP 拉取上下文并回传设计。',
      );
      await refresh({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开 OpenDesign 失败');
    } finally {
      setOpenDesignBusy(false);
    }
  }

  async function launchLocalOpenDesignBrainstorm() {
    if (!workflowRun || openDesignBusy) return;
    setOpenDesignBusy(true);
    try {
      const started = await api.retryOpenDesignBrainstormHandoff(workflowRun.id);
      if (!(await probeFlowxLocal(started.loopbackPort))) {
        toast.error('未检测到本机 flowx-local，请先完成本地安装（设置 → 本地 Agent）');
        return;
      }
      const local = await launchOpenDesignLocal(
        { ticket: started.ticket, apiBaseUrl: getFlowxApiBaseUrl() },
        started.loopbackPort,
      );
      toast.success(
        local.opened
          ? '已打开 Open Design。请按 flowx-product-prd：头脑风暴澄清 → 写 prd.md → 确认后再 MCP 回传产品需求。'
          : '构思会话已就绪。请先 flowx-local setup，再打开 Open Design，头脑风暴并确认 prd.md 后回传。',
      );
      await refresh({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开 OpenDesign 构思失败');
    } finally {
      setOpenDesignBusy(false);
    }
  }

  async function submitLocalOpenDesign() {
    if (!workflowRun || openDesignBusy) return;
    setOpenDesignBusy(true);
    try {
      if (!(await probeFlowxLocal())) {
        toast.error('未检测到本机 flowx-local，请先完成本地安装（设置 → 本地 Agent）');
        return;
      }
      const handoff = await api.getOpenDesignHandoff(workflowRun.id);
      const result = await submitOpenDesignLocal(handoff.executionSessionId);
      if (result.queued) {
        toast.error('FlowX API 暂不可用，设计结果已进入本地 Outbox，稍后可运行 flowx-local sync');
      } else {
        toast.success('本地 OpenDesign 设计已回传，进入确认环节');
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回传 OpenDesign 设计失败');
    } finally {
      setOpenDesignBusy(false);
    }
  }

  async function submitLocalOpenDesignBrainstorm() {
    if (!workflowRun || openDesignBusy) return;
    setOpenDesignBusy(true);
    try {
      if (!(await probeFlowxLocal())) {
        toast.error('未检测到本机 flowx-local，请先完成本地安装（设置 → 本地 Agent）');
        return;
      }
      const handoff = await api.getOpenDesignBrainstormHandoff(workflowRun.id);
      const result = await submitOpenDesignLocal(handoff.executionSessionId);
      if (result.queued) {
        toast.error('FlowX API 暂不可用，产品需求（PRD）已进入本地 Outbox，稍后可运行 flowx-local sync');
      } else {
        toast.success('本地产品需求（PRD）已回传');
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回传产品需求失败');
    } finally {
      setOpenDesignBusy(false);
    }
  }

  function getEditableStageForSelectedStage(stageKey: WorkflowStageKey): EditableStage | null {
    if (stageKey === 'SPEC_PLAN') {
      return 'spec-plan';
    }
    if (stageKey === 'EXECUTION') {
      return 'execution';
    }
    if (stageKey === 'AI_REVIEW') {
      return 'review';
    }
    return null;
  }

  async function submitFeedback() {
    if (!workflowRun) {
      return;
    }

    const editableStage = getEditableStageForSelectedStage(selectedStage);
    if (!editableStage) {
      return;
    }

    const nextFeedback = feedbackText.trim();
    if (!nextFeedback) {
      toast.error('请输入你希望 AI 调整的意见');
      return;
    }

    setSubmittingAction('feedback');
    try {
      if (editableStage === 'spec-plan') {
        await api.reviseSpecPlan(workflowRun.id, nextFeedback);
      } else if (editableStage === 'execution') {
        await api.reviseExecution(workflowRun.id, nextFeedback);
      } else {
        await api.reviseReview(workflowRun.id, nextFeedback);
      }

      setFeedbackText('');
      await refresh();
      toast.success('AI 已根据意见重新处理当前阶段');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交意见失败');
    } finally {
      setSubmittingAction(null);
    }
  }

  async function submitRejectSpecPlan() {
    if (!workflowRun) {
      return;
    }

    const nextFeedback = feedbackText.trim();
    if (!nextFeedback) {
      toast.error('请输入驳回原因');
      return;
    }

    await runAction(
      'SPEC_PLAN',
      async () => {
        await api.rejectSpecPlan(workflowRun.id, nextFeedback);
        setFeedbackText('');
      },
      'Spec & Plan 已驳回',
    );
  }

  async function submitManualEdit() {
    if (!workflowRun) {
      return;
    }

    const editableStage = getEditableStageForSelectedStage(selectedStage);
    if (editableStage !== 'spec-plan') {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(manualEditDraft);
    } catch {
      toast.error('JSON 格式无效，请检查后再保存');
      return;
    }

    const normalized = parseSpecPlanOutput(parsed);
    if (!normalized) {
      toast.error('Spec & Plan 结构无效，需包含 spec.goal 与 plan.approach');
      return;
    }

    setSubmittingManualEdit(true);
    try {
      await api.manualEditSpecPlan(workflowRun.id, normalized);
      setSidebarMode('feedback');
      setManualEditDraft('');
      await refresh();
      toast.success('Spec & Plan 人工修改已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存人工修改失败');
    } finally {
      setSubmittingManualEdit(false);
    }
  }

  async function runFindingAction(findingId: string, action: () => Promise<unknown>, successText: string) {
    if (busyFindingId) {
      return;
    }

    setBusyFindingId(findingId);
    try {
      await action();
      await refresh({ silent: true });
      toast.success(successText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理审查条目失败');
    } finally {
      setBusyFindingId(null);
    }
  }

  async function handleRollbackToPreviousStage() {
    if (!workflowRun || !canRollbackToPreviousStage) {
      return;
    }

    const confirmed = await confirm({
      description: '确定回退到上一阶段吗？后续阶段产生的产物可能被清除，请在重新执行前确认需求与上下文。',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setRollingBack(true);
    try {
      const next = await api.rollbackWorkflowToPreviousStage(workflowRun.id);
      setWorkflowRun(next);
      toast.success('已回退到上一阶段，可在对应步骤重新执行');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回退失败');
    } finally {
      setRollingBack(false);
    }
  }

  async function handleDeleteWorkflow() {
    if (!workflowRun) {
      return;
    }

    const confirmed = await confirm({
      description: '删除后将清空这条工作流的阶段记录、审查结果和工作副本。确认删除吗？',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      await api.deleteWorkflowRun(workflowRun.id);
      toast.success('工作流已删除');
      navigate('/workflow-runs', { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除工作流失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handlePublishGitChanges() {
    if (!workflowRun) {
      return;
    }

    setPublishing(true);
    try {
      const result = await api.publishWorkflowGitChanges(workflowRun.id);
      setLastPublishedRepositories(result.repositories);
      await refresh({ silent: true });
      const branchSummary = result.repositories
        .map((item) => `${item.repository}: ${item.branch} @ ${item.remoteUrl}`)
        .join('；');
      toast.success(
        `已推送并校验 ${result.repositories.length} 个代码库。${branchSummary}。提交信息：${result.message}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交远程失败');
    } finally {
      setPublishing(false);
    }
  }

  async function handleReviseDesign() {
    if (!workflowRun || !designFeedback.trim()) {
      return;
    }

    setDesignSubmitting(true);
    try {
      await api.reviseWorkflowDesign(workflowRun.id, designFeedback.trim());
      setDesignFeedback('');
      await refresh();
      toast.success('设计方案修改意见已发送');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发送设计方案反馈失败');
    } finally {
      setDesignSubmitting(false);
    }
  }

  const stageContent = useMemo<Record<WorkflowStageKey, StageDetailView> | null>(() => {
    if (!workflowRun) {
      return null;
    }

    const groundingStage = getStage(workflowRun, 'REPOSITORY_GROUNDING');
    const brainstormStage = getStage(workflowRun, 'BRAINSTORM');
    const designStage = getStage(workflowRun, 'DESIGN');
    const specPlanStage = getStage(workflowRun, 'SPEC_PLAN');
    const executionStage = getStage(workflowRun, 'EXECUTION');
    const reviewStage = getStage(workflowRun, 'AI_REVIEW');
    const repositoryPaths = workflowRun.workflowRepositories.map((repository) => ({
      name: repository.name,
      localPath: repository.localPath,
    }));

    return {
      REPOSITORY_GROUNDING: {
        title: stageMeta.REPOSITORY_GROUNDING.stageNo,
        subtitle: stageMeta.REPOSITORY_GROUNDING.title,
        status: groundingStage?.status,
        statusMessage: groundingStage?.statusMessage,
        attempt: groundingStage?.attempt,
        output: sanitizeDisplayValue(groundingStage?.output, repositoryPaths),
        actions: [],
      },
      BRAINSTORM: {
        title: stageMeta.BRAINSTORM.stageNo,
        subtitle: stageMeta.BRAINSTORM.title,
        status: brainstormStage?.status,
        statusMessage: brainstormStage?.statusMessage,
        attempt: brainstormStage?.attempt,
        output: sanitizeDisplayValue(brainstormStage?.output, repositoryPaths),
        actions: [
          {
            key: 'open-local-opendesign-brainstorm',
            label: '打开本地构思',
            onClick: () => setOpenDesignGuideKind('brainstorm'),
            disabled: workflowRun.status !== 'BRAINSTORM_PENDING' || openDesignBusy,
            loading: openDesignBusy,
            variant: 'primary' as const,
          },
          {
            key: 'submit-local-opendesign-brainstorm',
            label: '回传 PRD',
            onClick: () => void submitLocalOpenDesignBrainstorm(),
            disabled: workflowRun.status !== 'BRAINSTORM_PENDING' || openDesignBusy,
            loading: openDesignBusy,
          },
          {
            key: 'run',
            label: 'AI 生成产品简报',
            onClick: () =>
              void runAction('BRAINSTORM', () => api.runBrainstorm(workflowRun.id), '产品构思已启动'),
            disabled: workflowRun.status !== 'BRAINSTORM_PENDING' || stageActionsLocked,
            loading: busyStage === 'BRAINSTORM',
          },
          {
            key: 'skip',
            label: '跳过构思',
            onClick: () =>
              void runAction('BRAINSTORM', () => api.skipBrainstorm(workflowRun.id), '已跳过构思', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'BRAINSTORM_PENDING' || stageActionsLocked,
            loading: busyStage === 'BRAINSTORM',
          },
          ...(workflowRun.status === 'DESIGN_PENDING' ||
          workflowRun.status === 'DESIGN_WAITING_CONFIRMATION'
            ? [
                {
                  key: 'restart-brainstorm',
                  label: '重新构思',
                  danger: true as const,
                  disabled: stageActionsLocked,
                  loading: busyStage === 'BRAINSTORM',
                  onClick: () => {
                    void (async () => {
                      const confirmed = await confirm({
                        description: '将回到产品构思并重新编写产品需求；已有设计产物会保留供对照。',
                        destructive: true,
                      });
                      if (!confirmed) {
                        return;
                      }
                      await runAction(
                        'BRAINSTORM',
                        () => api.rollbackWorkflowToPreviousStage(workflowRun.id),
                        '已回到产品构思，可重新打开本地构思',
                      );
                      setSelectedStage('BRAINSTORM');
                    })();
                  },
                },
              ]
            : []),
        ],
      },
      DESIGN: {
        title: stageMeta.DESIGN.stageNo,
        subtitle: stageMeta.DESIGN.title,
        status: designStage?.status,
        statusMessage: designStage?.statusMessage,
        attempt: designStage?.attempt,
        output: null,
        actions: [
          {
            key: 'open-local-opendesign',
            label: '打开本地 OpenDesign',
            onClick: () => setOpenDesignGuideKind('design'),
            disabled: workflowRun.status !== 'DESIGN_PENDING' || openDesignBusy,
            loading: openDesignBusy,
            variant: 'primary' as const,
          },
          {
            key: 'submit-local-opendesign',
            label: '回传本地设计',
            onClick: () => void submitLocalOpenDesign(),
            disabled: workflowRun.status !== 'DESIGN_PENDING' || openDesignBusy,
            loading: openDesignBusy,
          },
          {
            key: 'run',
            label: 'AI 生成设计方案',
            onClick: () =>
              void runAction('DESIGN', () => api.runDesign(workflowRun.id), '设计方案生成已启动'),
            disabled:
              workflowRun.runType === 'LOCAL_DESIGN' ||
              workflowRun.status !== 'DESIGN_PENDING' ||
              stageActionsLocked,
            loading: busyStage === 'DESIGN',
          },
          {
            key: 'confirm',
            label: '确认设计方案',
            onClick: () =>
              void runAction(
                'DESIGN',
                () => api.confirmWorkflowDesign(workflowRun.id),
                '设计方案已确认',
                { focusNextStage: true },
              ),
            disabled: workflowRun.status !== 'DESIGN_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'DESIGN',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () =>
              void runAction('DESIGN', () => api.rejectWorkflowDesign(workflowRun.id), '设计方案已驳回，可重新生成'),
            disabled: workflowRun.status !== 'DESIGN_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'DESIGN',
            danger: true,
          },
          {
            key: 'skip',
            label: '跳过设计',
            onClick: () =>
              void runAction('DESIGN', () => api.skipDesign(workflowRun.id), '已跳过设计', {
                focusNextStage: true,
              }),
            disabled:
              (workflowRun.status !== 'DESIGN_PENDING' &&
                workflowRun.status !== 'DESIGN_WAITING_CONFIRMATION') ||
              stageActionsLocked,
            loading: busyStage === 'DESIGN',
          },
        ],
      },
      SPEC_PLAN: {
        title: stageMeta.SPEC_PLAN.stageNo,
        subtitle: stageMeta.SPEC_PLAN.title,
        status: specPlanStage?.status,
        statusMessage: specPlanStage?.statusMessage,
        attempt: specPlanStage?.attempt,
        output: sanitizeDisplayValue(specPlanStage?.output, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: '生成 Spec & Plan',
            onClick: () => void runAction('SPEC_PLAN', () => api.runSpecPlan(workflowRun.id), 'Spec & Plan 已启动'),
            disabled: workflowRun.status !== 'SPEC_PLAN_PENDING' || stageActionsLocked,
            loading: busyStage === 'SPEC_PLAN',
            variant: 'primary' as const,
          },
          {
            key: 'confirm',
            label: '确认',
            onClick: () =>
              void runAction('SPEC_PLAN', () => api.confirmSpecPlan(workflowRun.id), 'Spec & Plan 已确认', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'SPEC_PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'SPEC_PLAN',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () => void submitRejectSpecPlan(),
            disabled:
              workflowRun.status !== 'SPEC_PLAN_WAITING_CONFIRMATION' ||
              stageActionsLocked ||
              !feedbackText.trim(),
            loading: busyStage === 'SPEC_PLAN',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled: workflowRun.status !== 'SPEC_PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('spec-plan'),
            disabled: workflowRun.status !== 'SPEC_PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
          },
        ],
      },
      EXECUTION: {
        title: stageMeta.EXECUTION.stageNo,
        subtitle: stageMeta.EXECUTION.title,
        status: executionStage?.status,
        statusMessage: executionStage?.statusMessage,
        attempt: executionStage?.attempt,
        output: sanitizeDisplayValue(workflowRun.codeExecution, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: '云端执行',
            onClick: () => void runAction('EXECUTION', () => api.runExecution(workflowRun.id), '开发执行已启动'),
            disabled:
              workflowRun.status !== 'EXECUTION_PENDING' || stageActionsLocked || localExecutionActive,
            loading: busyStage === 'EXECUTION',
            variant: 'primary' as const,
          },
          {
            key: 'claim-local',
            label: '本地启动',
            onClick: () => setLocalLaunchOpen(true),
            disabled:
              (workflowRun.status !== 'EXECUTION_PENDING' && !localExecutionActive) || busyStage !== null,
            loading: localLaunchBusy,
          },
          {
            key: 'complete-local',
            label: '完成本地执行',
            onClick: () => {
              const handoff = localHandoff;
              if (handoff) {
                setCompleteLocalReports(
                  Object.fromEntries(
                    handoff.repositories.map((repository) => [
                      repository.workflowRepositoryId,
                      { headSha: '', changedFiles: '', patchSummary: '' },
                    ]),
                  ),
                );
              }
              setCompleteLocalOpen(true);
            },
            disabled: !localExecutionActive || stageActionsLocked || !localHandoff,
          },
          {
            key: 'cancel-local',
            label: '取消本地执行',
            onClick: () =>
              void runAction(
                'EXECUTION',
                async () => {
                  const updated = await api.cancelLocalExecution(workflowRun.id);
                  setLocalHandoff(null);
                  return updated;
                },
                '本地执行已取消',
                { allowWhileRunning: true },
              ),
            disabled: !localExecutionActive || stageActionsLocked,
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled:
              (workflowRun.status !== 'REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('execution'),
            disabled:
              !workflowRun.codeExecution ||
              !['REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflowRun.status) ||
              stageActionsLocked,
          },
        ],
      },
      AI_REVIEW: {
        title: stageMeta.AI_REVIEW.stageNo,
        subtitle: stageMeta.AI_REVIEW.title,
        status: reviewStage?.status,
        statusMessage: reviewStage?.statusMessage,
        attempt: reviewStage?.attempt,
        output: sanitizeDisplayValue(workflowRun.reviewReport, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: workflowRun.reviewReport ? '重新执行 AI 审查' : '执行 AI 审查',
            onClick: () => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动'),
            disabled:
              !['REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflowRun.status) ||
              stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
            variant: 'primary' as const,
          },
          {
            key: 'accept',
            label: '通过',
            onClick: () =>
              void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'accept'), '工作流已通过', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rework',
            label: '返工',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rework'), '工作流已退回开发执行'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rollback',
            label: '回滚',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rollback'), '工作流已回滚'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled:
              (workflowRun.status !== 'HUMAN_REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('review'),
            disabled:
              (workflowRun.status !== 'HUMAN_REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
        ],
      },
      HUMAN_REVIEW: {
        title: stageMeta.HUMAN_REVIEW.stageNo,
        subtitle: stageMeta.HUMAN_REVIEW.title,
        status: workflowRun.status === 'HUMAN_REVIEW_PENDING' || workflowRun.status === 'DONE' ? 'WAITING_CONFIRMATION' : undefined,
        statusMessage: null,
        attempt: undefined,
        output: null,
        actions: [],
      },
    };
  }, [workflowRun, busyStage, stageActionsLocked, localHandoff, localExecutionActive, localLaunchBusy, openDesignBusy, feedbackText]);

  if (!workflowRunId) {
    return <Navigate to="/workflow-runs" replace />;
  }

  const selectedStageContent = stageContent?.[selectedStage];
  const selectedStageIndex = STAGE_SEQUENCE.indexOf(selectedStage);
  const reviewReportId = workflowRun?.reviewReport?.id ?? null;
  const workflowWorkspaceConfig = useMemo<WorkflowWorkspaceConfig | null>(() => {
    if (!selectedStageContent) {
      return null;
    }

    const editableStage = getEditableStageForSelectedStage(selectedStage);
    if (!editableStage) {
      return null;
    }

    const actionsByKey = new Map(selectedStageContent.actions.map((action) => [action.key, action]));
    const runActionView = actionsByKey.get('run');
    const localLaunchAction = actionsByKey.get('claim-local');
    const completeLocalAction = actionsByKey.get('complete-local');
    const cancelLocalAction = actionsByKey.get('cancel-local');
    const confirmAction = actionsByKey.get('confirm');
    const rejectAction = actionsByKey.get('reject');
    const acceptAction = actionsByKey.get('accept');
    const editAction = actionsByKey.get('edit');

    const canSendFeedback = Boolean(actionsByKey.get('feedback')) && selectedStageContent.actions.some((action) => action.key === 'feedback' && !action.disabled);
    const isManualEditMode = sidebarMode === 'manual-edit' && editableStage === 'spec-plan';

    const primaryAction: WorkflowWorkspaceAction = isManualEditMode
      ? {
          key: 'save-manual-edit',
          label: '保存人工修改',
          onClick: () => void submitManualEdit(),
          disabled: !manualEditDraft.trim() || submittingManualEdit || stageActionsLocked,
          loading: submittingManualEdit,
          variant: 'primary',
        }
      : canSendFeedback
      ? {
          key: 'send-feedback',
          label: '发送修改意见',
          onClick: () => void submitFeedback(),
          disabled: !feedbackText.trim() || submittingAction !== null || stageActionsLocked,
          loading: submittingAction === 'feedback',
          variant: 'primary',
        }
      : selectedStage === 'EXECUTION' && localLaunchAction
        ? {
            key: localLaunchAction.key,
            label: localLaunchAction.label,
            onClick: localLaunchAction.onClick,
            disabled: localLaunchAction.disabled,
            loading: localLaunchAction.loading,
            variant: 'primary',
          }
      : {
          key: runActionView?.key ?? 'noop',
          label: runActionView?.label ?? '当前阶段暂无可执行操作',
          onClick: runActionView?.onClick ?? (() => undefined),
          disabled: runActionView?.disabled ?? true,
          loading: runActionView?.loading,
          variant: 'primary',
        };

    const secondaryActions: WorkflowWorkspaceAction[] = [];

    if (isManualEditMode) {
      secondaryActions.push({
        key: 'cancel-manual-edit',
        label: '返回修改意见',
        onClick: () => setSidebarMode('feedback'),
        disabled: submittingManualEdit,
      });
    }

    [
      !isManualEditMode && editAction
        ? {
            ...editAction,
            onClick: () => openWorkspaceEditMode(editableStage),
          }
        : undefined,
      selectedStage === 'EXECUTION' ? runActionView : undefined,
      selectedStage === 'EXECUTION' ? completeLocalAction : undefined,
      selectedStage === 'EXECUTION' ? cancelLocalAction : undefined,
      !isManualEditMode ? confirmAction : undefined,
      !isManualEditMode ? rejectAction : undefined,
      !isManualEditMode ? acceptAction : undefined,
    ]
      .filter((action): action is StageActionView => Boolean(action))
      .forEach((action) => {
        secondaryActions.push({
          key: action.key,
          label: action.label,
          onClick: action.onClick,
          disabled: action.disabled,
          loading: action.loading,
          danger: action.danger,
          variant: action.variant,
        });
      });

    return {
      stage: editableStage,
      title: selectedStageContent.subtitle,
      helperText: '边看左侧产物边写意见，不离开当前工作流上下文。',
      statusLabel: selectedStageContent.status ? formatStageExecutionStatus(selectedStageContent.status) : '未开始',
      feedbackPlaceholder: '描述你希望 AI 如何调整当前阶段的产出，例如补充遗漏任务、调整技术路线、补测试或修正审查重点。',
      primaryAction,
      secondaryActions,
    };
  }, [
    selectedStageContent,
    selectedStage,
    feedbackText,
    submittingAction,
    stageActionsLocked,
    sidebarMode,
    manualEditDraft,
    submittingManualEdit,
    workflowRun,
  ]);

  return (
    <>
      <OpenDesignLaunchGuideDialog
        open={openDesignGuideKind !== null}
        onOpenChange={(open) => {
          if (!open) setOpenDesignGuideKind(null);
        }}
        confirmDisabled={openDesignBusy}
        onConfirm={() => {
          const kind = openDesignGuideKind;
          setOpenDesignGuideKind(null);
          if (kind === 'brainstorm') {
            void launchLocalOpenDesignBrainstorm();
          } else if (kind === 'design') {
            void launchLocalOpenDesign();
          }
        }}
      />

      <Dialog open={localLaunchOpen} onOpenChange={setLocalLaunchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择 IDE</DialogTitle>
            <DialogDescription>
              FlowX 会通过本机 flowx-local 打开所选 IDE，并将当前工作流的执行上下文交给它。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <UiButton
              type="button"
              className="flex-1"
              disabled={localLaunchBusy}
              onClick={() => void launchLocalExecution('cursor')}
            >
              {localLaunchBusy ? '启动中...' : 'Cursor'}
            </UiButton>
            <UiButton
              type="button"
              variant="outline"
              className="flex-1"
              disabled={localLaunchBusy}
              onClick={() => void launchLocalExecution('codex')}
            >
              Codex
            </UiButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={completeLocalOpen} onOpenChange={setCompleteLocalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>完成本地执行</DialogTitle>
            <DialogDescription>
              填写各仓库推送后的 HEAD SHA 与变更文件列表。若仓库已登记远程 URL，需勾选「已推送」并通过服务端校验。
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCompleteLocalExecution();
            }}
          >
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={completeLocalPushed}
                onChange={(event) => setCompleteLocalPushed(event.target.checked)}
              />
              已推送到远程
            </label>
            {localHandoff?.repositories.map((repository) => {
              const report = completeLocalReports[repository.workflowRepositoryId] ?? {
                headSha: '',
                changedFiles: '',
                patchSummary: '',
              };
              return (
                <div
                  key={repository.workflowRepositoryId}
                  className="rounded-md border border-border bg-muted/30 px-4 py-4"
                >
                  <div className="text-sm font-semibold text-foreground">{repository.name}</div>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-foreground" htmlFor={`head-sha-${repository.workflowRepositoryId}`}>
                        HEAD SHA
                      </label>
                      <UiInput
                        id={`head-sha-${repository.workflowRepositoryId}`}
                        value={report.headSha}
                        onChange={(event) =>
                          setCompleteLocalReports((current) => ({
                            ...current,
                            [repository.workflowRepositoryId]: {
                              ...report,
                              headSha: event.target.value,
                            },
                          }))
                        }
                        placeholder="git rev-parse HEAD"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor={`changed-files-${repository.workflowRepositoryId}`}
                      >
                        变更文件（每行一个路径）
                      </label>
                      <UiTextarea
                        id={`changed-files-${repository.workflowRepositoryId}`}
                        value={report.changedFiles}
                        onChange={(event) =>
                          setCompleteLocalReports((current) => ({
                            ...current,
                            [repository.workflowRepositoryId]: {
                              ...report,
                              changedFiles: event.target.value,
                            },
                          }))
                        }
                        rows={4}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor={`patch-summary-${repository.workflowRepositoryId}`}
                      >
                        变更摘要（可选）
                      </label>
                      <UiInput
                        id={`patch-summary-${repository.workflowRepositoryId}`}
                        value={report.patchSummary}
                        onChange={(event) =>
                          setCompleteLocalReports((current) => ({
                            ...current,
                            [repository.workflowRepositoryId]: {
                              ...report,
                              patchSummary: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end gap-2">
              <UiButton type="button" variant="outline" onClick={() => setCompleteLocalOpen(false)}>
                取消
              </UiButton>
              <UiButton type="submit" disabled={completeLocalBusy}>
                {completeLocalBusy ? '提交中…' : '确认完成'}
              </UiButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {workflowRun ? (
        <div className="flex flex-col gap-5">
          <DetailHeader
            eyebrow="Workflow Detail"
            title={workflowRun.requirement.title}
            badges={[
              ...(workflowRun.runType === 'BUG_FIX'
                ? [{ key: 'run-type', label: formatWorkflowRunType(workflowRun.runType), variant: 'default' as const }]
                : []),
              { key: 'workspace', label: workflowRun.requirement.project.workspace.name, variant: 'default' },
              { key: 'project', label: workflowRun.requirement.project.name, variant: 'outline' },
              {
                key: 'provider',
                label: workflowRun.aiProvider === 'cursor' ? 'Cursor CLI' : 'Codex',
                variant: 'outline',
              },
              { key: 'id', label: workflowRun.id, variant: 'outline' },
              { key: 'status', label: formatWorkflowStatus(workflowRun.status), variant: 'secondary' },
            ]}
            actions={
              <>
                <UiButton
                  variant="outline"
                  disabled={!canRollbackToPreviousStage || rollingBack}
                  onClick={() => void handleRollbackToPreviousStage()}
                >
                  {rollingBack ? '回退中...' : '回退到上一阶段'}
                </UiButton>
                <UiButton variant="destructive" disabled={deleting || hasRunningStage} onClick={() => void handleDeleteWorkflow()}>
                  {deleting ? '删除中...' : '删除工作流'}
                </UiButton>
                {workflowRun.fixForBug?.id ? (
                  <UiButton variant="outline" asChild>
                    <Link to={`/bugs/${workflowRun.fixForBug.id}`}>查看关联缺陷</Link>
                  </UiButton>
                ) : null}
                <UiButton variant="outline" asChild>
                  <Link to="/workflow-runs">返回列表</Link>
                </UiButton>
              </>
            }
          />

          {workflowRun.workflowRepositories.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/35 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm leading-6 text-muted-foreground">{branchSummaryText}</p>
                <UiButton
                  size="sm"
                  variant="ghost"
                  onClick={() => setBranchSummaryExpanded((current) => !current)}
                >
                  {branchSummaryExpanded ? '收起分支' : '查看分支'}
                </UiButton>
              </div>
              {branchSummaryExpanded ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {workflowRun.workflowRepositories.map((repository) => (
                    <div key={repository.id} className="text-sm leading-6 text-muted-foreground">
                      <span className="font-medium text-foreground">{repository.name}</span>
                      {' / '}
                      <span>{repository.workingBranch}</span>
                      {' / '}
                      <span>基线 {repository.baseBranch}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {workflowMetrics ? (
            <div className="grid gap-5 md:grid-cols-4">
              <MetricCard
                label="当前状态"
                value={formatWorkflowStatus(workflowRun.status)}
                helpText={hasRunningStage ? '当前有阶段正在后台执行。' : '当前没有后台执行中的阶段。'}
              />
              <MetricCard
                label="阶段进度"
                value={`${workflowMetrics.completedStages}/${STAGE_SEQUENCE.length}`}
                helpText="已完成阶段数，按任务拆解到 AI 审查统计。"
              />
              <MetricCard
                label="待人工处理"
                value={workflowMetrics.waitingStages}
                helpText="等待人工确认或下一步决策的阶段数量。"
              />
              <MetricCard
                label="代码上下文"
                value={workflowMetrics.repositoryCount}
                helpText={
                  workflowMetrics.findingsCount > 0
                    ? `已沉淀 ${workflowMetrics.findingsCount} 条审查条目。`
                    : '当前还没有沉淀的审查条目。'
                }
              />
            </div>
          ) : null}

          <ContextPanel
            eyebrow="Workflow Context"
            title="需求与验收信息"
            description="集中查看本次工作流对应的需求背景与完成标准。"
          >
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">需求描述</div>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">
                  {workflowRun.requirement.description?.trim() || '当前需求尚未填写描述。'}
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">验收标准</div>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">
                  {workflowRun.requirement.acceptanceCriteria?.trim() || '当前需求尚未填写验收标准。'}
                </p>
              </div>
            </div>
          </ContextPanel>

          <Card className="rounded-md border-border bg-card">
            <CardHeader className="p-5 pb-0">
              <SectionHeader
                eyebrow="Workflow Steps"
                title="按阶段查看流程与产物"
                className="flex flex-wrap items-start justify-between gap-3"
                extra={<span className="text-sm leading-6 text-muted-foreground">点击步骤切换详情，产物仅在下方显示</span>}
              />
            </CardHeader>
            <CardContent className="p-5 pt-4">
              <WorkflowSteps
                current={selectedStageIndex}
                className="workflow-steps"
                onChange={(next) => setSelectedStage(STAGE_SEQUENCE[next] ?? 'SPEC_PLAN')}
                items={STAGE_SEQUENCE.map((stageKey) => {
                  const stage = getStage(workflowRun, stageKey);
                  return {
                    key: stageKey,
                    title: stageMeta[stageKey].stepLabel,
                    description: getStepDescription(stage),
                    status: getStepVisualStatus(stage?.status),
                  };
                })}
              />
            </CardContent>
          </Card>

          <div className="grid items-start gap-5 min-[1281px]:grid-cols-[minmax(0,1.5fr)_360px] max-[1280px]:grid-cols-1">
            {/* Left: main content */}
            <div className="flex flex-col gap-5">
              {selectedStageContent ? (
                <StageCard
                  title={selectedStageContent.title}
                  subtitle={selectedStageContent.subtitle}
                  status={selectedStageContent.status}
                  statusMessage={selectedStageContent.statusMessage}
                  attempt={selectedStageContent.attempt}
                  metaItems={[
                    { key: 'step', label: '当前步骤', value: `${selectedStageIndex + 1}/${STAGE_SEQUENCE.length}` },
                    {
                      key: 'focus-status',
                      label: '阶段状态',
                      value: (
                        <Badge
                          variant={
                            selectedStageContent.status === 'COMPLETED' || selectedStageContent.status === 'SKIPPED'
                              ? 'success'
                              : selectedStageContent.status === 'FAILED' || selectedStageContent.status === 'REJECTED'
                                ? 'destructive'
                                : selectedStageContent.status === 'WAITING_CONFIRMATION' || selectedStageContent.status === 'RUNNING'
                                  ? 'warning'
                                  : 'default'
                          }
                        >
                          {selectedStageContent.status ? formatStageExecutionStatus(selectedStageContent.status) : '未开始'}
                        </Badge>
                      ),
                    },
                  ]}
                  output={selectedStageContent.output}
                  actions={workflowWorkspaceConfig ? [] : selectedStageContent.actions}
                />
              ) : (
                <Card className="rounded-md border border-border bg-card">
                  <CardContent className="p-5">
                    <EmptyState description="当前阶段还没有可展示的详情产物。" />
                  </CardContent>
                </Card>
              )}

              {selectedStage === 'DESIGN' && workflowRun ? (
                <DesignDocumentPanel output={getStage(workflowRun, 'DESIGN')?.output} />
              ) : null}

              {selectedStage === 'DESIGN' && workflowRun ? (
                <Card className="rounded-md border-border bg-card">
                  <CardHeader className="p-5 pb-0">
                    <SectionHeader
                      eyebrow="Design Preview"
                      title="设计稿预览"
                      description="OpenDesign 生成的高保真单页设计稿。可通过下方反馈让 AI 迭代修改后重新生成。"
                    />
                  </CardHeader>
                  <CardContent className="p-5 pt-4">
                    <DesignArtifactPreview
                      workflowRunId={workflowRun.id}
                      reloadKey={`${workflowRun.status}:${getStage(workflowRun, 'DESIGN')?.attempt ?? 0}`}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {selectedStage === 'SPEC_PLAN' && selectedSpecPlanOutput ? (
                <Card className="rounded-md border-border bg-card">
                  <CardHeader className="p-5 pb-0">
                    <SectionHeader eyebrow="Spec & Plan" title="Spec & Plan 文档" />
                  </CardHeader>
                  <CardContent className="p-5 pt-4">
                    <SpecPlanDocumentPanel output={selectedSpecPlanOutput} />
                  </CardContent>
                </Card>
              ) : null}

              {selectedStage === 'EXECUTION' && localExecutionActive && localHandoff ? (
                <Card className="rounded-md border-border bg-card">
                  <CardHeader className="p-5 pb-0">
                    <SectionHeader
                      eyebrow="Local Handoff"
                      title="本地执行指引"
                      description="使用「本地启动」通过 flowx-local 打开 IDE；开发后提交并 push，再填写完成表单。"
                    />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5 p-5 pt-4">
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                      <li>点击「本地启动」并选择 Cursor 或 Codex</li>
                      <li>
                        若尚未安装 flowx-local，macOS / Linux 执行{' '}
                        <code className="text-foreground">{localInstallCurl}</code>
                        ，Windows PowerShell 执行{' '}
                        <code className="text-foreground">{localInstallPs1}</code>
                        ，然后{' '}
                        <code className="text-foreground">flowx-local login</code>
                      </li>
                      <li>拉取远程并切换到工作分支</li>
                      <li>按技术方案完成开发</li>
                      <li>提交并推送到远程</li>
                      <li>点击「完成本地执行」回写工作流</li>
                    </ol>
                    {localLaunchSetupRequired ? (
                      <div className="rounded-md border border-warning/40 bg-muted/30 p-3 text-sm text-foreground">
                        <div className="font-semibold">未检测到本机 flowx-local</div>
                        <div className="mt-1 text-muted-foreground">
                          macOS / Linux 执行{' '}
                          <code className="text-foreground">{localInstallCurl}</code>
                          ，Windows PowerShell 执行{' '}
                          <code className="text-foreground">{localInstallPs1}</code>
                          ，然后{' '}
                          <code className="text-foreground">flowx-local login</code>
                        </div>
                      </div>
                    ) : null}
                    {localHandoff.repositories.map((repository) => (
                      <div
                        key={repository.workflowRepositoryId}
                        className="rounded-md border border-border bg-muted/30 px-4 py-4 text-sm"
                      >
                        <div className="font-semibold text-foreground">{repository.name}</div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>
                            工作分支：<code className="text-foreground">{repository.workingBranch}</code>
                            <UiButton
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="ml-2 h-7 px-2"
                              onClick={() => void navigator.clipboard.writeText(repository.workingBranch)}
                            >
                              复制分支
                            </UiButton>
                          </div>
                          <div>基线分支：{repository.baseBranch}</div>
                          <div className="mt-3 font-medium text-foreground">建议提交说明</div>
                          <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-2 text-xs">
                            {repository.suggestedCommitMessage}
                          </pre>
                          <div className="mt-3 font-medium text-foreground">Git 命令</div>
                          <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-background p-2 text-xs leading-6">
                            {`${repository.checkout.fetch}\n${repository.checkout.checkout}\n# ... 开发并提交 ...\n${repository.checkout.push}`}
                          </pre>
                          <UiButton
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                `${repository.checkout.fetch}\n${repository.checkout.checkout}\n${repository.checkout.push}`,
                              )
                            }
                          >
                            复制命令
                          </UiButton>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {selectedStage === 'EXECUTION' && executionSessionId ? (
                <ExecutionSessionPanel
                  session={executionSession}
                  evidence={executionEvidence}
                  events={executionEvents}
                  loading={executionSessionLoading}
                  onRefresh={() => void refreshExecutionSession()}
                />
              ) : null}

              {selectedStage === 'EXECUTION' && executionHtml ? (
                <Card className="rounded-md border-border bg-card">
                  <CardHeader className="p-5 pb-0">
                    <SectionHeader eyebrow="Execution Report" title="执行报告" />
                  </CardHeader>
                  <CardContent className="p-5 pt-4">
                    <iframe
                      title="执行报告预览"
                      sandbox=""
                      srcDoc={executionHtml}
                      className="h-[480px] w-full rounded-md border border-border"
                    />
                  </CardContent>
                </Card>
              ) : null}


              {diffReviewData.length > 0 && (selectedStage === 'EXECUTION' || selectedStage === 'AI_REVIEW') ? (
              <Card className="rounded-md border-border bg-card">
                <CardHeader className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4 max-[1180px]:flex-col">
                    <SectionHeader
                      eyebrow="Diff Review"
                      title="代码变更审查"
                      description="先确认变更范围，再逐文件查看真实差异，最后结合 AI 审查结果做人工判断。"
                    />
                    <div className="grid min-w-[340px] grid-cols-3 gap-[10px] max-[1180px]:min-w-0 max-[1180px]:grid-cols-2 max-[780px]:grid-cols-1">
                      <StatPill label="变更仓库" value={diffReviewData.length} />
                      <StatPill
                        label="变更文件"
                        value={diffReviewData.reduce((total, artifact) => total + artifact.files.length, 0)}
                      />
                      <StatPill
                        label="未跟踪文件"
                        value={diffReviewData.reduce((total, artifact) => total + artifact.untrackedFiles.length, 0)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  {activeArtifact ? (
                    <Tabs
                      value={activeArtifact.artifactKey}
                      onValueChange={(value) => {
                        const nextArtifact = diffReviewData.find((item) => item.artifactKey === value);
                        setSelectedArtifactKey(value);
                        setSelectedDiffFileKey(nextArtifact?.files[0]?.key ?? null);
                      }}
                    >
                      <TabsList>
                        {diffReviewData.map((artifact) => (
                          <TabsTrigger
                            key={artifact.artifactKey}
                            value={artifact.artifactKey}
                            className="flex min-w-[180px] flex-col items-start justify-start gap-1"
                          >
                            <span className="text-sm font-semibold">{artifact.repository}</span>
                            <span className="text-xs text-muted-foreground">{artifact.branch}</span>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {diffReviewData.map((artifact) => {
                        const artifactFiles = artifact.files;
                        const currentFile =
                          artifact.artifactKey === activeArtifact.artifactKey
                            ? activeDiffFile
                            : artifact.files.find((item) => item.key === selectedDiffFileKey) ?? artifact.files[0] ?? null;

                        return (
                          <TabsContent key={artifact.artifactKey} value={artifact.artifactKey}>
                            <div className="grid items-start gap-4 [grid-template-columns:320px_minmax(0,1fr)] max-[1440px]:[grid-template-columns:280px_minmax(0,1fr)] max-[1180px]:grid-cols-1">
                              <DiffFileListPanel
                                count={artifactFiles.length}
                                files={artifactFiles}
                                activeKey={currentFile?.key}
                                onSelect={(key) => {
                                  if (artifact.artifactKey !== activeArtifact.artifactKey) {
                                    setSelectedArtifactKey(artifact.artifactKey);
                                  }
                                  setSelectedDiffFileKey(key);
                                }}
                              />

                              <DiffViewerPanel
                                filePath={currentFile?.path}
                                repository={artifact.repository}
                                branch={artifact.branch}
                                diffText={currentFile?.diffText}
                              />
                            </div>
                          </TabsContent>
                        );
                      })}
                    </Tabs>
                  ) : (
                    <EmptyState description="当前执行结果还没有可审查的 diff。" />
                  )}
                </CardContent>
              </Card>
            ) : null}

            {selectedStage === 'AI_REVIEW' ? (
              <Card className="rounded-md border-border bg-card">
                <CardHeader className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-4 max-[960px]:flex-col">
                    <SectionHeader
                      eyebrow="AI Review Results"
                      title="AI 审查结果"
                      description="直接基于审查结果决定继续修复、转为问题项或转为缺陷，不再额外理解中间对象。"
                    />
                    <div className="flex flex-col items-end gap-3 max-[960px]:items-start">
                      <div className="flex flex-wrap justify-end gap-2 max-[960px]:justify-start">
                        <Badge variant="secondary">{workflowRun.reviewFindings.length} 条结果</Badge>
                        <Badge variant="default">{workflowRun.reviewFindings.filter((item) => !item.convertedIssueId && !item.convertedBugId).length} 条待处理</Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  {hasStaleReviewResults ? (
                    <div className="mb-4 flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
                      <div>
                        当前展示的是上一轮 AI 审查结果。你可以继续逐条修复，也可以在任何时候重新执行 AI 审查来刷新结果。
                      </div>
                      <div>
                        <UiButton
                          onClick={() => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动')}
                          disabled={stageActionsLocked}
                        >
                          {busyStage === 'AI_REVIEW' ? '处理中...' : '重新执行 AI 审查'}
                        </UiButton>
                      </div>
                    </div>
                  ) : null}
                  {workflowRun.reviewFindings.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {workflowRun.reviewFindings.map((finding) => (
                        <ReviewFindingCard
                          key={finding.id}
                          id={finding.id}
                          title={finding.title}
                          type={finding.type}
                          severity={finding.severity}
                          status={finding.status}
                          description={finding.description}
                          impactScope={finding.impactScope}
                          actions={[
                            {
                              key: 'fix',
                              label: busyFindingId === finding.id ? '处理中...' : '立即修复',
                              variant: 'outline',
                              onClick: () =>
                                void runFindingAction(
                                  finding.id,
                                  () => api.fixReviewFinding(workflowRun.id, finding.id),
                                  '已开始基于该审查结果继续修复，请检查代码变更后再执行 AI 审查',
                                ),
                              disabled:
                                busyFindingId !== null ||
                                finding.status === 'FIXED_PENDING_REVIEW' ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE'),
                            },
                            {
                              key: 'issue',
                              label: busyFindingId === finding.id ? '处理中...' : '转问题项',
                              variant: 'outline',
                              onClick: () =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToIssue(finding.id), '已录入为问题项'),
                              disabled:
                                busyFindingId !== null ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE') ||
                                !!finding.convertedIssueId ||
                                !!finding.convertedBugId,
                            },
                            {
                              key: 'bug',
                              label: busyFindingId === finding.id ? '处理中...' : '转缺陷',
                              onClick: () =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToBug(finding.id), '已录入为缺陷'),
                              disabled:
                                busyFindingId !== null ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE') ||
                                !!finding.convertedIssueId ||
                                !!finding.convertedBugId,
                            },
                          ]}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      description={
                        reviewReportId && busyFindingId === `sync:${reviewReportId}`
                          ? '正在整理 AI 审查结果...'
                          : '当前还没有可操作的 AI 审查结果。'
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ) : null}

            {workflowRun.status === 'DONE' ? (
              <Card className="rounded-md border-border bg-card">
                <CardHeader className="p-5">
                  <SectionHeader
                    eyebrow="Git Publish"
                    title="提交到远程"
                    description="人工确认通过后，会基于当前工作分支生成唯一的发布分支，并将代码推送到远程仓库。"
                  />
                </CardHeader>
                <CardContent className="flex flex-col gap-4 p-5 pt-0">
                  <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                    这个动作会自动完成 git add、git commit 和 git push。推送时不会直接复用工作分支，而是生成唯一的发布分支，避免与远端已有分支冲突。
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <UiButton onClick={() => void handlePublishGitChanges()} disabled={publishing}>
                      {publishing ? '处理中...' : '提交并推送到远程'}
                    </UiButton>
                  </div>
                  {lastPublishedRepositories.length > 0 ? (
                    <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm leading-6 text-success">
                      最近一次推送：{lastPublishedRepositories.map((item) => `${item.repository} / ${item.branch} / ${item.commitSha}`).join('；')}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            </div>

            {/* Right: sidebar */}
            <div
              data-testid="workflow-review-sidebar-shell"
              className="flex flex-col gap-5 self-start min-[1281px]:sticky min-[1281px]:top-6"
            >
              {isDesignFeedbackVisible ? (
                <Card className="border-border">
                  <CardContent className="flex flex-col gap-4 p-5">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Design Spec</p>
                      <div>
                        <h4 className="text-base font-semibold text-foreground">设计方案反馈区</h4>
                        <p className="text-sm text-muted-foreground">
                          基于仓库 Design System 与组件选型，补充页面结构、状态与交互修正意见；确认前可反复修订 AI 输出。
                        </p>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">当前阶段</p>
                      <p className="mt-1 text-sm font-medium text-foreground">设计方案（DesignSpec）</p>
                      <p className="mt-1 text-xs text-muted-foreground">此阶段不写入可运行 Demo 代码，确认后再进入 Demo 生成。</p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">修改意见</p>
                      <UiTextarea
                        value={designFeedback}
                        onChange={(event) => setDesignFeedback(event.target.value)}
                        placeholder="例如：列表空态与错误态需单独说明；主按钮与次要操作在首屏的层级；与现有设计 token 的对应关系。"
                        rows={8}
                        className="min-h-[220px] resize-y"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <UiButton
                        onClick={() => void handleReviseDesign()}
                        disabled={!canReviseDesignSpec || !designFeedback.trim() || designSubmitting}
                      >
                        {designSubmitting ? '发送中...' : '发送设计修订意见'}
                      </UiButton>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              {workflowWorkspaceConfig ? (
                <WorkflowReviewSidebar
                  stageTitle={workflowWorkspaceConfig.title}
                  stageStatusLabel={workflowWorkspaceConfig.statusLabel}
                  helperText={workflowWorkspaceConfig.helperText}
                  mode={sidebarMode}
                  feedbackText={feedbackText}
                  feedbackPlaceholder={workflowWorkspaceConfig.feedbackPlaceholder}
                  onFeedbackChange={setFeedbackText}
                  manualEditText={manualEditDraft}
                  manualEditPlaceholder='{"spec":{"goal":"..."},"plan":{"approach":"..."}}'
                  onManualEditChange={setManualEditDraft}
                  primaryAction={workflowWorkspaceConfig.primaryAction}
                  secondaryActions={workflowWorkspaceConfig.secondaryActions}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <Card className="rounded-md border border-border bg-card">
          <CardContent className="p-5">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner className="h-7 w-7" />
              </div>
            ) : (
              <EmptyState description="没有找到对应的工作流记录。" />
            )}
          </CardContent>
        </Card>
      )}

    </>
  );
}
