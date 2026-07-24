import type { ContextRepository } from './context-package.js';

export interface OpenDesignBrainstormContextPackage {
  protocolVersion: string;
  generatedAt: string;
  sourceTool: 'opendesign';
  stage: 'BRAINSTORM';
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  requirement: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
  repositories: ContextRepository[];
  outputContract: {
    resultFileName: 'spec.md';
    format: 'flowx-brainstorm-markdown-v1';
  };
  metadata?: Record<string, unknown>;
}

export interface BrainstormCompletionReport {
  idempotencyKey: string;
  markdown: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenDesignBrainstormHandoff {
  protocolVersion: string;
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  contextPackage: OpenDesignBrainstormContextPackage;
  completionEndpoint: string;
}
