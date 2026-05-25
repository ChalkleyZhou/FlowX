import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainstormOutput } from '../common/types';
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
});
