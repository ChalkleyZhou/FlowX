import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

export interface ReviewSkillMatch {
  absolutePath: string;
  relativePath: string;
  content: string;
}

const SKILL_SEARCH_ROOTS = ['.cursor/skills', '.agents/skills', '.claude/skills'];
const SKILL_FILE_NAME = 'skill.md';
const PREFERRED_PATH_HINT = 'code-review';

interface SkillFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  folderName: string;
}

/**
 * Walk the well-known skill directories under a repo root and return the first
 * SKILL.md whose folder name or frontmatter mentions "review". Pure fs walk,
 * synchronous, no AI calls, so the caller can gate an AI review before spending
 * a model invocation on a repo that has no review skill on disk.
 */
export function findReviewSkill(repoRoot: string): ReviewSkillMatch | null {
  const root = repoRoot.trim();
  if (!root || !existsSync(root)) {
    return null;
  }

  const skillFiles: SkillFile[] = [];
  for (const searchRoot of SKILL_SEARCH_ROOTS) {
    collectSkillFiles(root, join(root, searchRoot), skillFiles);
  }

  const matches = skillFiles.filter(isReviewSkill);
  if (matches.length === 0) {
    return null;
  }

  const preferred =
    matches.find((match) => match.relativePath.toLowerCase().includes(PREFERRED_PATH_HINT)) ??
    matches[0];

  return {
    absolutePath: preferred.absolutePath,
    relativePath: preferred.relativePath,
    content: preferred.content,
  };
}

function collectSkillFiles(repoRoot: string, dir: string, out: SkillFile[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSkillFiles(repoRoot, absolutePath, out);
      continue;
    }
    if (!entry.isFile() || entry.name.toLowerCase() !== SKILL_FILE_NAME) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch {
      continue;
    }

    const relativeParts = relative(repoRoot, absolutePath).split(sep);
    out.push({
      absolutePath,
      relativePath: relativeParts.join('/'),
      content,
      folderName: relativeParts.length >= 2 ? relativeParts[relativeParts.length - 2] : '',
    });
  }
}

function isReviewSkill(file: SkillFile): boolean {
  if (file.folderName.toLowerCase().includes('review')) {
    return true;
  }
  return extractFrontmatter(file.content).toLowerCase().includes('review');
}

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : content;
}
