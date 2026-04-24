import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAiExecutor } from './codex-ai.executor';

describe('CodexAiExecutor', () => {
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
