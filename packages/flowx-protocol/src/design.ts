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
    /** 人读设计文档，与 brainstorm 的 prd.md 对齐 */
    markdownFileName: 'design.md';
    format: 'flowx-design-result-v2';
    requiredFields: readonly ['design', 'demo', 'surfaces'];
  };
  metadata?: Record<string, unknown>;
}

export interface DesignPagePayload {
  id: string;
  title?: string;
  html: string;
  [key: string]: unknown;
}

export interface DesignSurfacePayload {
  id: string;
  pages: DesignPagePayload[];
  [key: string]: unknown;
}

export interface FlowXDesignOutput {
  design: Record<string, unknown>;
  demo: Record<string, unknown>;
  surfaces: DesignSurfacePayload[];
}

export interface DesignCompletionReport {
  idempotencyKey: string;
  /** 平台「设计文档」模块唯一正文 */
  markdown: string;
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
