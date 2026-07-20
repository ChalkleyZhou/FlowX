import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainstormOutput, ReviewDailyChangesInput } from '../common/types';
import { CodexAiExecutor } from './codex-ai.executor';

describe('CodexAiExecutor', () => {
  const strictBrainstorm = (executor: CodexAiExecutor, raw: unknown): BrainstormOutput =>
    (executor as unknown as { assertStrictBrainstormOutput: (r: unknown) => BrainstormOutput }).assertStrictBrainstormOutput(
      raw,
    );

  it('assertStrictBrainstormOutput rejects flat brainstorm JSON at root', () => {
    const executor = new CodexAiExecutor();

    expect(() =>
      strictBrainstorm(executor, {
        expandedDescription: 'Direct payload',
        userStories: [{ role: 'user', action: 'do x', benefit: 'get y' }],
        edgeCases: ['empty state'],
        successMetrics: ['conversion'],
        openQuestions: ['scope?'],
        assumptions: ['admin user exists'],
        outOfScope: ['mobile'],
      }),
    ).toThrow(/brief/i);
  });

  it('assertStrictBrainstormOutput accepts wrapped brief matching brainstorm.output.schema.json', () => {
    const executor = new CodexAiExecutor();

    const out = strictBrainstorm(executor, {
      brief: {
        expandedDescription: 'Details',
        userStories: [
          { role: 'u1', action: 'a1', benefit: 'b1' },
          { role: 'u2', action: 'a2', benefit: 'b2' },
          { role: 'u3', action: 'a3', benefit: 'b3' },
        ],
        edgeCases: ['e1', 'e2', 'e3'],
        successMetrics: ['s'],
        openQuestions: ['q'],
        assumptions: ['a'],
        outOfScope: ['o'],
      },
    });

    expect(out.brief.expandedDescription).toBe('Details');
    expect(out.brief.userStories).toHaveLength(3);
  });

  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('builds repository component context from monorepo app roots', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'flowx-codex-context-'));
    tempDirs.push(repoRoot);

    const componentDir = join(repoRoot, 'apps', 'admin-app', 'src', 'components', 'ui');
    const pageDir = join(repoRoot, 'apps', 'admin-app', 'src', 'pages');
    await mkdir(componentDir, { recursive: true });
    await mkdir(pageDir, { recursive: true });

    await writeFile(
      join(componentDir, 'DictionaryToolbar.tsx'),
      `
export interface DictionaryToolbarProps {
  canCreate: boolean;
}

export function DictionaryToolbar(_props: DictionaryToolbarProps) {
  return null;
}
`,
      'utf8',
    );
    await writeFile(
      join(pageDir, 'DictionaryPage.tsx'),
      `
export function DictionaryPage() {
  return <div>Dictionary</div>;
}
`,
      'utf8',
    );

    const executor = new CodexAiExecutor();
    const context = await (
      executor as unknown as {
        buildRepositoryComponentContext: (repository: {
          id: string;
          name: string;
          url: string;
          defaultBranch: string | null;
          localPath: string;
          syncStatus: string;
        }) => Promise<{
          componentFiles: string[];
          propTypes: Array<{ name: string; props: string }>;
          pageExamples: Array<{ path: string; code: string }>;
          designTokens?: string;
        } | null>;
      }
    ).buildRepositoryComponentContext({
      id: 'repo-1',
      name: 'ai-platform',
      url: 'https://example.com/repo.git',
      defaultBranch: 'main',
      localPath: repoRoot,
      syncStatus: 'READY',
    });

    expect(context).not.toBeNull();
    expect(context?.componentFiles).toContain('apps/admin-app/src/components/ui/DictionaryToolbar.tsx');
    expect(context?.pageExamples.some((page) => page.path === 'apps/admin-app/src/pages/DictionaryPage.tsx')).toBe(
      true,
    );
  });

  describe('daily code review prompt', () => {
    const buildInput = (
      overrides: Partial<ReviewDailyChangesInput['unit']> = {},
    ): ReviewDailyChangesInput => ({
      unit: {
        repositoryName: 'flowx-api',
        repositoryId: 'repo-1',
        localPath: '/sandbox/flowx-api-a1b2c3d4',
        ref: 'main',
        commits: [],
        date: '2026-07-20',
        rangeLabel: '2026-07-20',
        discoveredSkill: { relativePath: '.cursor/skills/code-review/SKILL.md', content: 'skill body' },
        workspaceRepositoryMap: [
          { name: 'flowx-api', repositoryId: 'repo-1', localPath: '/sandbox/flowx-api-a1b2c3d4' },
          { name: 'flowx-web', repositoryId: 'repo-2', localPath: '/sandbox/flowx-web-e5f6a7b8' },
        ],
        ...overrides,
      },
      workspace: null,
    });

    const buildPrompt = async (executor: CodexAiExecutor, input: ReviewDailyChangesInput) =>
      (
        executor as unknown as {
          buildDailyCodeReviewPrompt: (i: ReviewDailyChangesInput) => Promise<string>;
        }
      ).buildDailyCodeReviewPrompt(input);

    it('instructs the agent to review the whole current tree, not just the diff', async () => {
      const executor = new CodexAiExecutor();
      const prompt = await buildPrompt(executor, buildInput());

      expect(prompt).toContain('当前仓库完整代码树');
      expect(prompt).toContain('仅作可选上下文');
      expect(prompt).toContain('无 commit 也必须照常完成整仓审查');
    });

    it('tells the agent to resolve sibling repos by name via workspaceRepositoryMap, never by slug-id folder name', async () => {
      const executor = new CodexAiExecutor();
      const prompt = await buildPrompt(executor, buildInput());

      expect(prompt).toContain('workspaceRepositoryMap');
      expect(prompt).toContain('按仓库名称');
      expect(prompt).toContain('slug-id');
    });

    it('forbids modifying business files, committing, or pushing', async () => {
      const executor = new CodexAiExecutor();
      const prompt = await buildPrompt(executor, buildInput());

      expect(prompt).toContain('严禁修改任何业务文件');
      expect(prompt).toMatch(/git commit/);
      expect(prompt).toMatch(/git push/);
    });

    it('renders workspaceRepositoryMap as JSON so the skill can resolve sibling repos by name', async () => {
      const executor = new CodexAiExecutor();
      const prompt = await buildPrompt(executor, buildInput());

      expect(prompt).toContain('workspaceRepositoryMap');
      expect(prompt).toContain(JSON.stringify(
        [
          { name: 'flowx-api', repositoryId: 'repo-1', localPath: '/sandbox/flowx-api-a1b2c3d4' },
          { name: 'flowx-web', repositoryId: 'repo-2', localPath: '/sandbox/flowx-web-e5f6a7b8' },
        ],
        null,
        2,
      ));
    });

    it('still renders the discovered skill content', async () => {
      const executor = new CodexAiExecutor();
      const prompt = await buildPrompt(executor, buildInput());

      expect(prompt).toContain('.cursor/skills/code-review/SKILL.md');
      expect(prompt).toContain('skill body');
    });
  });

  describe('reviewDailyChanges repositoryDirs', () => {
    it('adds the unit localPath and every workspaceRepositoryMap localPath to the codex cwd allowlist', async () => {
      const executor = new CodexAiExecutor();
      const runJsonStage = vi
        .spyOn(executor as unknown as { runJsonStage: (...args: unknown[]) => Promise<unknown> }, 'runJsonStage')
        .mockResolvedValue({
          status: 'COMPLETED',
          issues: [],
          bugs: [],
          missingTests: [],
          suggestions: [],
          impactScope: [],
        });

      await executor.reviewDailyChanges({
        unit: {
          repositoryName: 'flowx-api',
          repositoryId: 'repo-1',
          localPath: '/sandbox/flowx-api-a1b2c3d4',
          ref: 'main',
          commits: [],
          date: '2026-07-20',
          rangeLabel: '2026-07-20',
          workspaceRepositoryMap: [
            { name: 'flowx-api', repositoryId: 'repo-1', localPath: '/sandbox/flowx-api-a1b2c3d4' },
            { name: 'flowx-web', repositoryId: 'repo-2', localPath: '/sandbox/flowx-web-e5f6a7b8' },
          ],
        },
        workspace: null,
      });

      expect(runJsonStage).toHaveBeenCalledTimes(1);
      const [, , , repositoryDirs] = runJsonStage.mock.calls[0]!;
      expect(repositoryDirs).toEqual([
        '/sandbox/flowx-api-a1b2c3d4',
        '/sandbox/flowx-web-e5f6a7b8',
      ]);
    });

    it('deduplicates when unit localPath is already present in workspaceRepositoryMap', async () => {
      const executor = new CodexAiExecutor();
      const runJsonStage = vi
        .spyOn(executor as unknown as { runJsonStage: (...args: unknown[]) => Promise<unknown> }, 'runJsonStage')
        .mockResolvedValue({
          status: 'COMPLETED',
          issues: [],
          bugs: [],
          missingTests: [],
          suggestions: [],
          impactScope: [],
        });

      await executor.reviewDailyChanges({
        unit: {
          repositoryName: 'flowx-api',
          repositoryId: 'repo-1',
          localPath: '/sandbox/flowx-api-a1b2c3d4',
          ref: 'main',
          commits: [],
          date: '2026-07-20',
          rangeLabel: '2026-07-20',
          workspaceRepositoryMap: [
            { name: 'flowx-api', repositoryId: 'repo-1', localPath: '/sandbox/flowx-api-a1b2c3d4' },
          ],
        },
        workspace: null,
      });

      const [, , , repositoryDirs] = runJsonStage.mock.calls[0]!;
      expect(repositoryDirs).toEqual(['/sandbox/flowx-api-a1b2c3d4']);
    });
  });
});
