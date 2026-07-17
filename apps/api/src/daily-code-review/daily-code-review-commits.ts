import type { BriefingCommit } from '../briefings/briefing-commits';

export interface DailyCodeReviewCommitGroup {
  repositoryId: string | null;
  repositoryName: string;
  ref: string;
  commits: BriefingCommit[];
}

export function groupCommitsForDailyReview(commits: BriefingCommit[]): DailyCodeReviewCommitGroup[] {
  const groups = new Map<string, DailyCodeReviewCommitGroup>();

  for (const commit of commits) {
    const repositoryId = commit.repositoryId?.trim() || null;
    const repositoryName = commit.projectName.trim();
    const ref = commit.ref?.trim() || 'unknown';
    const key = repositoryId ? `${repositoryId}::${ref}` : `${repositoryName}::${ref}`;
    const existing = groups.get(key);
    if (existing) {
      existing.commits.push(commit);
      continue;
    }
    groups.set(key, {
      repositoryId,
      repositoryName,
      ref,
      commits: [commit],
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftName = left.repositoryName;
    const rightName = right.repositoryName;
    const repoCompare = leftName.localeCompare(rightName);
    if (repoCompare !== 0) {
      return repoCompare;
    }
    return left.ref.localeCompare(right.ref);
  });
}

export interface RepositoryLookupEntry {
  id: string;
  name: string;
  url: string;
  defaultBranch: string | null;
  currentBranch: string | null;
  localPath: string | null;
  syncStatus: string;
}

export function buildRepositoryLookupById(
  repositories: RepositoryLookupEntry[],
): Map<string, RepositoryLookupEntry> {
  const lookup = new Map<string, RepositoryLookupEntry>();
  for (const repository of repositories) {
    lookup.set(repository.id, repository);
  }
  return lookup;
}

export function buildRepositoryLookupByName(
  repositories: RepositoryLookupEntry[],
): Map<string, RepositoryLookupEntry> {
  const lookup = new Map<string, RepositoryLookupEntry>();
  for (const repository of repositories) {
    lookup.set(repository.name.trim().toLowerCase(), repository);
  }
  return lookup;
}

export function resolveRepositoryForReview(
  group: Pick<DailyCodeReviewCommitGroup, 'repositoryId' | 'repositoryName'>,
  lookupById: Map<string, RepositoryLookupEntry>,
  lookupByName: Map<string, RepositoryLookupEntry>,
): RepositoryLookupEntry | null {
  if (group.repositoryId) {
    return lookupById.get(group.repositoryId) ?? null;
  }
  return lookupByName.get(group.repositoryName.trim().toLowerCase()) ?? null;
}
