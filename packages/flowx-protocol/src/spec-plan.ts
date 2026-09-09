import type { ContextRepository } from './context-package.js';

export interface SpecPlanSpec {
  goal: string;
  scope: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  constraints: string[];
}

export interface SpecPlanPlan {
  approach: string;
  touchpoints: string[];
  sequence: string[];
  risks: string[];
  verification: string[];
}

export interface SpecPlanNotes {
  checklist?: string[];
  openQuestions?: string[];
}

export interface SpecPlanOutput {
  spec: SpecPlanSpec;
  plan: SpecPlanPlan;
  notes?: SpecPlanNotes;
}

export interface LocalSpecPlanContextPackage {
  protocolVersion: string;
  generatedAt: string;
  sourceTool: 'cursor' | 'codex';
  stage: 'SPEC_PLAN';
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  sourceFingerprint: string;
  requirement: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
  repositories: ContextRepository[];
  brainstormContext?: unknown;
  designContext?: unknown;
  outputContract: {
    resultFileName: 'spec-plan.json';
    specFileName: 'spec.md';
    planFileName: 'plan.md';
    format: 'flowx-spec-plan-v1';
  };
}

export interface LocalSpecPlanHandoff {
  protocolVersion: string;
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  contextPackage: LocalSpecPlanContextPackage;
  completionEndpoint: string;
}

export interface SpecPlanCompletionReport {
  idempotencyKey: string;
  sourceFingerprint: string;
  output: SpecPlanOutput;
  artifactIds?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}
