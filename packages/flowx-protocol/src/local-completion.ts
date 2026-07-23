export type LocalCompletionRepositoryReport = {
  workflowRepositoryId: string;
  headSha: string;
  changedFiles: string[];
  patchSummary?: string;
};

export type LocalCompletionReport = {
  idempotencyKey: string;
  pushed: boolean;
  implementationSummary?: string;
  testResult?: string;
  diffSummary?: string;
  untrackedFiles?: string[];
  summary?: string;
  repositories: LocalCompletionRepositoryReport[];
  metadata?: Record<string, unknown>;
};

export function buildLocalCompletionIdempotencyKey(input: {
  executionSessionId: string;
  headShas: string[];
}): string {
  const tip = input.headShas.map((s) => s.trim()).filter(Boolean).sort().join('+') || 'none';
  return `local:${input.executionSessionId}:${tip}`;
}

export function assertLocalCompletionReport(value: unknown): LocalCompletionReport {
  if (!value || typeof value !== 'object') {
    throw new Error('LocalCompletionReport must be an object');
  }
  const report = value as LocalCompletionReport;
  if (!report.idempotencyKey?.trim()) {
    throw new Error('idempotencyKey is required');
  }
  if (typeof report.pushed !== 'boolean') {
    throw new Error('pushed must be a boolean');
  }
  if (!Array.isArray(report.repositories) || report.repositories.length === 0) {
    throw new Error('repositories must be a non-empty array');
  }
  for (const repo of report.repositories) {
    if (!repo.workflowRepositoryId?.trim() || !repo.headSha?.trim()) {
      throw new Error('repository workflowRepositoryId and headSha are required');
    }
    if (!Array.isArray(repo.changedFiles) || repo.changedFiles.length === 0) {
      throw new Error('changedFiles must be a non-empty array');
    }
  }
  return report;
}
