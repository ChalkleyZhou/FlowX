export type LocalWorkflowAction = 'generate' | 'wait_for_confirmation' | 'none';

export type LocalWorkflowStage = 'brainstorm' | 'design' | 'spec-plan' | 'execution' | null;

export interface LocalOutputContract {
  files: string[];
  format: string;
}

export interface WorkflowPositionPriorOutput {
  stage: Exclude<LocalWorkflowStage, 'execution' | null>;
  stageExecutionId: string;
  status: string;
  files: string[];
  summary: string;
}

export interface WorkflowPositionArtifactRef {
  id: string;
  artifactType: string;
  name: string;
}

export interface ResolvedLocalPosition {
  localAction: LocalWorkflowAction;
  stage: LocalWorkflowStage;
  message: string;
  outputContract: LocalOutputContract | null;
}

const OUTPUT_CONTRACTS: Record<Exclude<LocalWorkflowStage, null>, LocalOutputContract> = {
  brainstorm: { files: ['prd.md'], format: 'flowx-brainstorm-markdown-v1' },
  design: { files: ['design.md'], format: 'flowx-design-result-v2' },
  'spec-plan': {
    files: ['spec.md', 'plan.md', 'spec-plan.json'],
    format: 'flowx-spec-plan-v1',
  },
  execution: { files: [], format: 'flowx-local-execution-v1' },
};

const POSITION_BY_STATUS: Record<string, Omit<ResolvedLocalPosition, 'outputContract'> & { stage: LocalWorkflowStage }> = {
  BRAINSTORM_PENDING: {
    localAction: 'generate',
    stage: 'brainstorm',
    message: '当前可以做产品构思。',
  },
  DESIGN_PENDING: {
    localAction: 'generate',
    stage: 'design',
    message: '当前可以做设计。',
  },
  DESIGN_WAITING_CONFIRMATION: {
    localAction: 'wait_for_confirmation',
    stage: 'design',
    message: '设计已提交，等待网页确认。确认前不要开始下一步。',
  },
  SPEC_PLAN_PENDING: {
    localAction: 'generate',
    stage: 'spec-plan',
    message: '当前可以做 Spec & Plan。已完成的 PRD 和设计只作为上下文。',
  },
  SPEC_PLAN_WAITING_CONFIRMATION: {
    localAction: 'wait_for_confirmation',
    stage: 'spec-plan',
    message: 'Spec & Plan 已提交，等待网页确认。确认前不要开始开发。',
  },
  SPEC_PLAN_CONFIRMED: {
    localAction: 'generate',
    stage: 'execution',
    message: '方案已确认，可以开始本地开发。',
  },
  EXECUTION_PENDING: {
    localAction: 'generate',
    stage: 'execution',
    message: '当前可以做本地开发。',
  },
  EXECUTION_RUNNING: {
    localAction: 'generate',
    stage: 'execution',
    message: '本地开发进行中，完成后回报。',
  },
  REVIEW_PENDING: {
    localAction: 'wait_for_confirmation',
    stage: null,
    message: '等待 AI 审查。本地不要开始下一阶段。',
  },
  HUMAN_REVIEW_PENDING: {
    localAction: 'wait_for_confirmation',
    stage: null,
    message: '等待网页人工确认。',
  },
  DONE: {
    localAction: 'none',
    stage: null,
    message: '这条流程已完成。',
  },
  FAILED: {
    localAction: 'none',
    stage: null,
    message: '这条流程已失败。',
  },
};

const PRIOR_STAGES = {
  BRAINSTORM: { stage: 'brainstorm' as const, files: ['prd.md'] },
  DESIGN: { stage: 'design' as const, files: ['design.md'] },
  SPEC_PLAN: { stage: 'spec-plan' as const, files: ['spec.md', 'plan.md', 'spec-plan.json'] },
};

const VISIBLE_STAGE_STATUSES = new Set(['COMPLETED', 'WAITING_CONFIRMATION']);

export function resolveLocalPosition(status: string): ResolvedLocalPosition {
  const normalized = status.trim().toUpperCase();
  const matched = POSITION_BY_STATUS[normalized] ?? {
    localAction: 'none' as const,
    stage: null,
    message: '当前状态还不能在本地继续。',
  };
  return {
    ...matched,
    outputContract: matched.localAction === 'generate' && matched.stage ? OUTPUT_CONTRACTS[matched.stage] : null,
  };
}

export function summarizePriorOutputs(
  executions: Array<{ id: string; stage: string; status: string; attempt?: number; output?: unknown }>,
): WorkflowPositionPriorOutput[] {
  const sorted = [...executions].sort((left, right) => (right.attempt ?? 0) - (left.attempt ?? 0));
  const seen = new Set<string>();
  const results: WorkflowPositionPriorOutput[] = [];
  for (const execution of sorted) {
    const key = execution.stage.trim().toUpperCase();
    const known = PRIOR_STAGES[key as keyof typeof PRIOR_STAGES];
    if (!known || seen.has(key) || !VISIBLE_STAGE_STATUSES.has(execution.status.trim().toUpperCase())) {
      continue;
    }
    seen.add(key);
    results.push({
      stage: known.stage,
      stageExecutionId: execution.id,
      status: execution.status,
      files: known.files,
      summary: excerptOutput(execution.output),
    });
  }
  return results;
}

function excerptOutput(output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return '';
  }
  const record = output as Record<string, unknown>;
  const markdown = typeof record.markdown === 'string' ? record.markdown : '';
  const spec = record.spec;
  const goal =
    spec && typeof spec === 'object' && !Array.isArray(spec) && typeof (spec as { goal?: unknown }).goal === 'string'
      ? (spec as { goal: string }).goal
      : '';
  const summary = typeof record.summary === 'string' ? record.summary : '';
  const text = markdown || goal || summary;
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean);
  return (line ?? '').slice(0, 160);
}
