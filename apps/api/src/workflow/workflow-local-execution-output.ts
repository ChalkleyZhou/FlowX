import type { ExecuteTaskOutput } from '../common/types';
import type { CompleteLocalExecutionDto } from './dto/complete-local-execution.dto';
import type { LocalHandoffPayload } from './workflow-local-handoff';

function buildLocalChatSummary(dto: CompleteLocalExecutionDto) {
  const lines = [
    dto.implementationSummary?.trim() ? `Summary: ${dto.implementationSummary.trim()}` : '',
    dto.testResult?.trim() ? `Tests: ${dto.testResult.trim()}` : '',
    dto.diffSummary?.trim() ? `Diff: ${dto.diffSummary.trim()}` : '',
  ].filter(Boolean);

  return lines.length > 0 ? ['[Local Chat]', ...lines].join('\n') : '';
}

export function buildExecutionOutputFromLocalReport(
  handoff: LocalHandoffPayload,
  dto: CompleteLocalExecutionDto,
): ExecuteTaskOutput {
  const repoById = new Map(handoff.repositories.map((repository) => [repository.workflowRepositoryId, repository]));
  const summaries: string[] = [];
  const changedFiles = new Set<string>();
  const codeChanges: ExecuteTaskOutput['codeChanges'] = [];
  const diffArtifacts: ExecuteTaskOutput['diffArtifacts'] = [];

  for (const report of dto.repositories) {
    const repository = repoById.get(report.workflowRepositoryId);
    if (!repository) {
      continue;
    }

    const summary =
      report.patchSummary?.trim() ||
      `${repository.name}: ${report.changedFiles.length} file(s) on ${repository.workingBranch}`;
    summaries.push(summary);

    for (const file of report.changedFiles) {
      const normalized = file.trim();
      if (!normalized) {
        continue;
      }
      changedFiles.add(normalized);
      codeChanges.push({
        file: normalized,
        changeType: 'update',
        summary: report.patchSummary?.trim() || `Local change on ${repository.workingBranch}`,
      });
    }

    diffArtifacts.push({
      repository: repository.name,
      branch: repository.workingBranch,
      localPath: '',
      diffStat: dto.diffSummary?.trim() || `local commit ${report.headSha.slice(0, 12)}`,
      diffText: '',
      untrackedFiles: dto.untrackedFiles ?? [],
    });
  }

  const localChatSummary = buildLocalChatSummary(dto);
  const repositorySummary = summaries.join('\n') || 'Local execution completed';

  return {
    patchSummary: [localChatSummary, repositorySummary].filter(Boolean).join('\n\n'),
    changedFiles: [...changedFiles],
    codeChanges,
    diffArtifacts,
  };
}
