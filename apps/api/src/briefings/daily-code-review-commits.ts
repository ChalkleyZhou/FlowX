import type { BriefingCommit } from './briefing-commits';

export interface DailyCodeReviewCommitGroup {
  repositoryName: string;
  ref: string;
  commits: BriefingCommit[];
}

export function groupCommitsForDailyReview(commits: BriefingCommit[]): DailyCodeReviewCommitGroup[] {
  const groups = new Map<string, DailyCodeReviewCommitGroup>();

  for (const commit of commits) {
    const repositoryName = commit.projectName.trim();
    const ref = commit.ref?.trim() || 'unknown';
    const key = `${repositoryName}::${ref}`;
    const existing = groups.get(key);
    if (existing) {
      existing.commits.push(commit);
      continue;
    }
    groups.set(key, {
      repositoryName,
      ref,
      commits: [commit],
    });
  }

  return [...groups.values()].sort((left, right) => {
    const repoCompare = left.repositoryName.localeCompare(right.repositoryName);
    if (repoCompare !== 0) {
      return repoCompare;
    }
    return left.ref.localeCompare(right.ref);
  });
}

export interface RepositoryLookupEntry {
  id: string;
  name: string;
  localPath: string | null;
}

export function buildRepositoryLookup(
  repositories: RepositoryLookupEntry[],
): Map<string, RepositoryLookupEntry> {
  const lookup = new Map<string, RepositoryLookupEntry>();
  for (const repository of repositories) {
    lookup.set(repository.name.trim().toLowerCase(), repository);
  }
  return lookup;
}

export function resolveRepositoryForCommit(
  repositoryName: string,
  lookup: Map<string, RepositoryLookupEntry>,
): RepositoryLookupEntry | null {
  return lookup.get(repositoryName.trim().toLowerCase()) ?? null;
}
