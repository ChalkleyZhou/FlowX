import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findReviewSkill } from './review-skill-discovery';

describe('findReviewSkill', () => {
  let repoRoot: string;
  const unreadableDirs: string[] = [];

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'flowx-review-skill-'));
    unreadableDirs.length = 0;
  });

  afterEach(() => {
    for (const dir of unreadableDirs) {
      try {
        chmodSync(dir, 0o755);
      } catch {
        // ignore restore failures during cleanup
      }
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function makeUnreadable(dir: string): void {
    chmodSync(dir, 0o000);
    unreadableDirs.push(dir);
  }

  function writeSkill(
    relativeDir: string,
    frontmatter: Record<string, string> = {},
    body = '# Skill\n',
  ): void {
    const dir = join(repoRoot, relativeDir);
    mkdirSync(dir, { recursive: true });
    const frontmatterBlock = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    const content = `---\n${frontmatterBlock}\n---\n\n${body}`;
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
  }

  it('finds .cursor/skills/code-review/SKILL.md', () => {
    writeSkill('.cursor/skills/code-review', {
      name: 'code-review',
      description: 'Review code changes for correctness, style and missing tests',
    });

    const found = findReviewSkill(repoRoot);

    expect(found?.relativePath).toBe('.cursor/skills/code-review/SKILL.md');
    expect(found?.absolutePath).toBe(join(repoRoot, '.cursor/skills/code-review/SKILL.md'));
    expect(found?.content).toContain('code-review');
  });

  it('returns null when no review skill exists', () => {
    writeSkill('.cursor/skills/openspec-propose', {
      name: 'openspec-propose',
      description: 'Propose a new change with all artifacts generated in one step',
    });

    expect(findReviewSkill(repoRoot)).toBeNull();
  });

  it('returns null when no skills directories exist at all', () => {
    expect(findReviewSkill(repoRoot)).toBeNull();
  });

  it('returns null when the repo root does not exist on disk', () => {
    expect(findReviewSkill(join(repoRoot, 'does-not-exist'))).toBeNull();
  });

  it('matches by folder name containing "review" even without a description mention', () => {
    writeSkill('.agents/skills/awesome-review', {
      name: 'awesome-review',
      description: 'Some unrelated description',
    });

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.agents/skills/awesome-review/SKILL.md');
  });

  it('matches by frontmatter description containing "review" even without a folder name mention', () => {
    writeSkill('.claude/skills/quality-gate', {
      name: 'quality-gate',
      description: 'Review code quality before merging',
    });

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.claude/skills/quality-gate/SKILL.md');
  });

  it('prefers a path containing "code-review" when multiple review skills match', () => {
    writeSkill('.cursor/skills/review-general', {
      name: 'review-general',
      description: 'General review skill',
    });
    writeSkill('.cursor/skills/code-review', {
      name: 'code-review',
      description: 'Review code changes',
    });

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.cursor/skills/code-review/SKILL.md');
  });

  it('searches nested skill directories under each root', () => {
    writeSkill('.agents/skills/superpowers/code-review', {
      name: 'code-review',
      description: 'Review code changes for correctness',
    });

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.agents/skills/superpowers/code-review/SKILL.md');
  });

  it('searches .claude/skills as a fallback root', () => {
    writeSkill('.claude/skills/code-review', {
      name: 'code-review',
      description: 'Review code changes',
    });

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.claude/skills/code-review/SKILL.md');
  });

  it('does not match on body text when YAML frontmatter is absent', () => {
    const dir = join(repoRoot, '.cursor/skills/quality-gate');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '# Quality Gate\n\nPlease review every change carefully.\n',
      'utf8',
    );

    expect(findReviewSkill(repoRoot)).toBeNull();
  });

  it('returns null instead of throwing when skills root is unreadable', () => {
    const skillsRoot = join(repoRoot, '.cursor/skills');
    mkdirSync(skillsRoot, { recursive: true });
    makeUnreadable(skillsRoot);

    expect(() => findReviewSkill(repoRoot)).not.toThrow();
    expect(findReviewSkill(repoRoot)).toBeNull();
  });

  it('skips an unreadable nested directory and still finds a sibling skill', () => {
    writeSkill('.cursor/skills/code-review', {
      name: 'code-review',
      description: 'Review code changes',
    });
    const lockedDir = join(repoRoot, '.cursor/skills/locked');
    mkdirSync(lockedDir, { recursive: true });
    makeUnreadable(lockedDir);

    const found = findReviewSkill(repoRoot);
    expect(found?.relativePath).toBe('.cursor/skills/code-review/SKILL.md');
  });
});
