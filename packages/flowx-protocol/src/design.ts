import type { ContextRepository } from './context-package.js';

export interface OpenDesignContextPackage {
  protocolVersion: string;
  generatedAt: string;
  sourceTool: 'opendesign';
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
    resultFileName: string;
    format: 'flowx-design-result-v1';
    requiredFields: readonly ['design', 'demo', 'designArtifact'];
  };
  metadata?: Record<string, unknown>;
}

export interface FlowXDesignOutput {
  design: Record<string, unknown>;
  demo: Record<string, unknown>;
  designArtifact: {
    html: string;
    [key: string]: unknown;
  };
}

export interface DesignCompletionReport {
  idempotencyKey: string;
  summary?: string;
  output: FlowXDesignOutput;
  metadata?: Record<string, unknown>;
}

export interface OpenDesignHandoff {
  protocolVersion: string;
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  contextPackage: OpenDesignContextPackage;
  completionEndpoint: string;
}
