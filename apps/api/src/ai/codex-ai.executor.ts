import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GeneratePlanInput,
  GeneratePlanOutput,
  RepositoryContext,
  ReviewCodeInput,
  ReviewCodeOutput,
  SplitTasksInput,
  SplitTasksOutput,
} from '../common/types';
import { executionPrompt } from '../prompts/execution.prompt';
import { reviewPrompt } from '../prompts/review.prompt';
import { taskSplitPrompt } from '../prompts/task-split.prompt';
import { technicalPlanPrompt } from '../prompts/technical-plan.prompt';
import { AIExecutor } from './ai-executor';

const execFile = promisify(execFileCallback);

@Injectable()
export class CodexAiExecutor implements AIExecutor {
  private readonly logger = new Logger(CodexAiExecutor.name);
  private readonly schemaDir = join(process.cwd(), 'apps/api/src/ai');

  async splitTasks(input: SplitTasksInput): Promise<SplitTasksOutput> {
    const prompt = await this.buildTaskSplitPrompt(input);
    const parsed = await this.runCodexJson<SplitTasksOutput>(
      'task-split.output.schema.json',
      prompt,
      'task split',
      this.getReadableRepositoryDirs(input.workspace?.repositories),
    );
    this.assertSplitTasksOutput(parsed);
    return parsed;
  }

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput> {
    const prompt = await this.buildTechnicalPlanPrompt(input);
    return this.runCodexJson<GeneratePlanOutput>(
      'technical-plan.output.schema.json',
      prompt,
      'technical plan',
      this.getReadableRepositoryDirs(input.workspace?.repositories),
    );
  }

  async executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput> {
    const repositories = input.workspace?.repositories.filter(
      (repository) => repository.localPath && repository.syncStatus === 'READY',
    );

    if (!repositories || repositories.length === 0) {
      throw new Error('No prepared workflow repositories are available for execution.');
    }

    for (const repository of repositories) {
      await this.runCodexMutation(
        repository.localPath!,
        await this.buildRepositoryExecutionPrompt(input, repository),
        `execution-${repository.name}`,
      );
    }

    const executionOutput = await this.collectExecutionOutput(repositories);
    if (executionOutput.changedFiles.length === 0) {
      throw new Error(this.buildNoChangeDiagnostic(input, repositories, executionOutput.diffArtifacts));
    }

    return executionOutput;
  }

  async reviewCode(input: ReviewCodeInput): Promise<ReviewCodeOutput> {
    const repositoryDiffSection = this.buildExecutionArtifactSection(
      input.execution.diffArtifacts,
    );

    return this.runCodexJson<ReviewCodeOutput>(
      'review.output.schema.json',
      await this.buildReviewPrompt(input, repositoryDiffSection),
      'review',
      this.getReadableRepositoryDirs(input.workspace?.repositories),
    );
  }

  private async buildTaskSplitPrompt(input: SplitTasksInput) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'snapshot');
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次任务拆解结果:
${JSON.stringify(input.previousOutput ?? {}, null, 2)}

请根据人工反馈修正上一次结果，而不是完全忽略既有上下文。`
      : '';

    return `${taskSplitPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${taskSplitPrompt.user}

你必须基于“实际仓库上下文”拆分任务，优先参考下方给出的真实目录结构和关键文件摘要。
如果仓库证据不足，应该在 ambiguities 中明确说明，而不是凭常见 React/Umi 目录结构自行脑补文件路径。

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}
${revisionSection}

请输出:
1. tasks: 面向当前工作区代码库的可执行研发任务，尽量具体到模块或改动方向
2. ambiguities: 仍待人工确认的关键不明确点
3. risks: 该需求实施过程中的主要风险
`;
  }

  private async buildTechnicalPlanPrompt(input: GeneratePlanInput) {
    const groundingSection = await this.buildWorkspaceSection(input.workspace, 'snapshot');
    const liveWorkspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次技术方案:
${JSON.stringify(input.previousOutput ?? {}, null, 2)}

请根据人工反馈修正方案，并尽量保留仍然合理的部分。`
      : '';

    return `${technicalPlanPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。
所有 filesToModify / newFiles 都必须使用“目标代码仓库根目录下的相对路径”。
不要输出 FlowX 编排系统文件、绝对路径、本地工作目录路径或临时目录路径。

${technicalPlanPrompt.user}

你必须严格依据下方给出的 repository grounding 结果和当前 workflow 仓库副本实时结构来生成方案。
grounding 结果用于告诉你仓库职责、说明文件、候选入口与证据文件；实时结构用于确认当前目录与文件现状。
不要假设项目一定存在 src/app.tsx、src/layouts、src/pages 等常见前端目录。
如果目标文件在仓库证据中无法成立，请调整方案，或者把不确定点写进风险与说明中。

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
repository grounding:
${groundingSection}

当前仓库实时结构:
${liveWorkspaceSection}
${revisionSection}

已确认任务:
${input.tasks.map((task, index) => `${index + 1}. ${task.title}: ${task.description}`).join('\n')}
`;
  }

  private async buildRepositoryExecutionPrompt(
    input: ExecuteTaskInput,
    repository: RepositoryContext,
  ) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

你需要基于这条反馈继续修改当前仓库，而不是回退已完成的合理改动。`
      : '';

    return `${executionPrompt.system}

你正在代码仓库内执行真实开发，请直接修改当前仓库工作区中的代码，不要只输出建议。
当前仓库:
- 名称: ${repository.name}
- URL: ${repository.url}
- 工作分支: ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}

${executionPrompt.user}

目标要求:
- 只在当前仓库内进行必要改动
- 优先落地已确认技术方案中与当前仓库相关的部分
- 不要创建与当前仓库无关的改动
- 所有涉及文件的描述都使用当前仓库根目录下的相对路径
- 不要提及 FlowX 编排系统文件或本地绝对路径
- 如果当前仓库存在可实施项，你必须至少落地一个真实文件改动，不能只做分析
- 如果你判断当前仓库不该改，请先检查技术方案中的文件和任务是否真的与当前仓库无关
- 如果最终仍无法修改，请在结束前明确写出阻塞原因，例如“计划文件路径不存在”或“当前仓库不包含目标模块”
- 完成后不要输出 Markdown，只需结束任务

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}

工作区仓库上下文:
${workspaceSection}
${revisionSection}

任务:
${input.tasks.map((task, index) => `${index + 1}. ${task.title}: ${task.description}`).join('\n')}

已确认技术方案:
- 摘要: ${input.plan.summary}
- 实施步骤:
${input.plan.implementationPlan.map((item, index) => `${index + 1}. ${item}`).join('\n')}
- 修改文件:
${input.plan.filesToModify.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 新增文件:
${input.plan.newFiles.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 风险点:
${input.plan.riskPoints.map((item) => `  - ${item}`).join('\n') || '  - 无'}
`;
  }

  private async buildReviewPrompt(input: ReviewCodeInput, repositoryDiffSection: string) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const diffSection = repositoryDiffSection
      ? `\n工作流代码差异:\n${repositoryDiffSection}`
      : '';
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次审查结果:
${JSON.stringify(input.previousOutput ?? {}, null, 2)}

请根据人工反馈修正审查结论。`
      : '';

    return `${reviewPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${reviewPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}
${revisionSection}

技术方案:
- 摘要: ${input.plan.summary}
- 实施步骤:
${input.plan.implementationPlan.map((item, index) => `${index + 1}. ${item}`).join('\n')}

执行结果:
- Patch 摘要: ${input.execution.patchSummary}
- 变更文件:
${input.execution.changedFiles.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 代码变更条目:
${input.execution.codeChanges
  .map((item, index) => `${index + 1}. ${item.file} | ${item.changeType} | ${item.summary}`)
  .join('\n')}
${diffSection}
`;
  }

  private async buildWorkspaceSection(workspace?: {
    name: string;
    description?: string | null;
    repositories: RepositoryContext[];
  } | null, mode: 'snapshot' | 'live' = 'snapshot') {
    if (!workspace) {
      return '\n工作区上下文:\n- 未提供工作区信息';
    }

    const repositorySections = workspace.repositories.length
      ? await Promise.all(
          workspace.repositories.map(async (repository) => {
            const baseLine =
              `  - ${repository.name} | URL: ${repository.url} | 默认分支: ${repository.defaultBranch ?? '未设置'} | 当前分支: ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}\n` +
              `    同步状态: ${repository.syncStatus ?? '未知'}`;
            const snapshot = await this.buildRepositoryContextNarrative(repository, mode);
            return `${baseLine}\n${snapshot}`;
          }),
        )
      : '  - 当前工作区未登记代码库';

    return `
工作区上下文:
- 名称: ${workspace.name}
- 描述: ${workspace.description ?? '无'}
- 代码库:
${Array.isArray(repositorySections) ? repositorySections.join('\n') : repositorySections}`;
  }

  private async buildRepositoryContextNarrative(
    repository: RepositoryContext,
    mode: 'snapshot' | 'live',
  ) {
    if (mode === 'snapshot' && repository.contextSnapshot?.summary) {
      return `    预生成仓库证据(${repository.contextSnapshot.strategy ?? 'unknown'}):\n${repository.contextSnapshot.summary
        .split('\n')
        .map((line) => `      ${line}`)
        .join('\n')}`;
    }

    return this.buildRepositorySnapshot(repository);
  }

  private async buildRepositorySnapshot(repository: RepositoryContext) {
    if (!repository.localPath || repository.syncStatus !== 'READY') {
      return '    仓库快照: 未提供可读的本地副本';
    }

    try {
      const rootEntries = await this.readDirectoryEntries(repository.localPath, 24);
      const focusDirectories = ['apps', 'packages', 'services', 'cmd', 'src', 'internal', 'api', 'web', 'client', 'server', 'pages', 'layouts', 'components', 'tests', 'test'];
      const focusSections = await Promise.all(
        focusDirectories.map(async (dir) => {
          const entries = await this.readDirectoryEntries(join(repository.localPath!, dir), 16);
          return entries.length > 0 ? `    ${dir}/:\n${entries.map((entry) => `      - ${entry}`).join('\n')}` : '';
        }),
      );

      const packageSummary = await this.readPackageJsonSummary(repository.localPath);

      return [
        '    实时仓库结构快照:',
        rootEntries.length > 0
          ? `${rootEntries.map((entry) => `      - ${entry}`).join('\n')}`
          : '      - 无法读取根目录',
        packageSummary ? `    package.json 摘要:\n${packageSummary}` : '',
        ...focusSections.filter(Boolean),
      ]
        .filter(Boolean)
        .join('\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown snapshot error';
      return `    仓库快照读取失败: ${message}`;
    }
  }

  private async readDirectoryEntries(path: string, limit: number) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => `${entry.isDirectory() ? '[D]' : '[F]'} ${entry.name}`);
    } catch {
      return [];
    }
  }

  private async readPackageJsonSummary(localPath: string) {
    try {
      const packageJson = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const scriptNames = Object.keys(packageJson.scripts ?? {}).slice(0, 12);
      const dependencyNames = [
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
      ].slice(0, 20);

      return [
        packageJson.name ? `      - name: ${packageJson.name}` : '',
        scriptNames.length > 0 ? `      - scripts: ${scriptNames.join(', ')}` : '',
        dependencyNames.length > 0 ? `      - dependencies: ${dependencyNames.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }

  private assertSplitTasksOutput(output: SplitTasksOutput) {
    if (!Array.isArray(output.tasks) || output.tasks.length === 0) {
      throw new Error('Codex did not return any tasks.');
    }
    if (!Array.isArray(output.ambiguities) || !Array.isArray(output.risks)) {
      throw new Error('Codex output shape is invalid.');
    }
  }

  private async runCodexJson<T>(
    schemaFile: string,
    prompt: string,
    stageName: string,
    addDirs: string[] = [],
  ): Promise<T> {
    const tempDir = await mkdtemp(join(tmpdir(), 'flowx-codex-'));
    const outputPath = join(tempDir, `${stageName.replace(/\s+/g, '-')}.json`);
    const schemaPath = join(this.schemaDir, schemaFile);
    const addDirArgs = addDirs.flatMap((dir) => ['--add-dir', dir]);

    try {
      const { stderr } = await execFile(
        'codex',
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--color',
          'never',
          '--ephemeral',
          ...addDirArgs,
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          prompt,
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          maxBuffer: 1024 * 1024 * 8,
        },
      );

      const rawOutput = (await readFile(outputPath, 'utf8')).trim();
      if (!rawOutput) {
        throw new Error(`Codex returned empty output. stderr=${stderr}`);
      }

      return JSON.parse(rawOutput) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex error';
      this.logger.error(`Codex ${stageName} failed: ${message}`);
      throw new Error(`Codex ${stageName} failed: ${message}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async runCodexMutation(cwd: string, prompt: string, stageName: string) {
    try {
      await execFile(
        'codex',
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'workspace-write',
          '--color',
          'never',
          '--ephemeral',
          '-C',
          cwd,
          prompt,
        ],
        {
          cwd,
          env: process.env,
          maxBuffer: 1024 * 1024 * 8,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Codex mutation error';
      this.logger.error(`Codex ${stageName} failed: ${message}`);
      throw new Error(`Codex ${stageName} failed: ${message}`);
    }
  }

  private async collectExecutionOutput(repositories: RepositoryContext[]): Promise<ExecuteTaskOutput> {
    const changedFiles: string[] = [];
    const codeChanges: ExecuteTaskOutput['codeChanges'] = [];
    const summaryLines: string[] = [];

    for (const repository of repositories) {
      const localPath = repository.localPath;
      if (!localPath) {
        continue;
      }

      const statuses = await this.getRepositoryStatus(localPath);
      if (statuses.length === 0) {
        continue;
      }

      let createdCount = 0;
      let updatedCount = 0;

      for (const item of statuses) {
        const fileLabel = `${repository.name}:${item.path}`;
        changedFiles.push(fileLabel);
        codeChanges.push({
          file: fileLabel,
          changeType: item.changeType,
          summary:
            item.changeType === 'create'
              ? `在 ${repository.name} 中新增 ${item.path}`
              : `在 ${repository.name} 中更新 ${item.path}`,
        });
        if (item.changeType === 'create') {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      summaryLines.push(
        `${repository.name}: 更新 ${updatedCount} 个文件，新增 ${createdCount} 个文件，工作分支 ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}`,
      );
    }

    return {
      patchSummary: summaryLines.join('\n'),
      changedFiles,
      codeChanges,
      diffArtifacts: await Promise.all(
        repositories.map(async (repository) => {
          const localPath = repository.localPath!;
          const diffStat = await this.getGitDiffStat(localPath);
          const diffText = await this.getGitDiffText(localPath);
          const untrackedFiles = await this.getUntrackedFiles(localPath);

          return {
            repository: repository.name,
            branch: repository.currentBranch ?? repository.defaultBranch ?? '未设置',
            localPath,
            diffStat,
            diffText: this.truncateText(diffText, 12000),
            untrackedFiles,
          };
        }),
      ),
    };
  }

  private buildNoChangeDiagnostic(
    input: ExecuteTaskInput,
    repositories: RepositoryContext[],
    diffArtifacts: ExecuteTaskOutput['diffArtifacts'],
  ) {
    const planFiles = [
      ...(input.plan.filesToModify ?? []),
      ...(input.plan.newFiles ?? []),
    ];

    const repositoryLines = repositories.map((repository) => {
      const artifact = diffArtifacts.find((item) => item.repository === repository.name);
      const diffStat = artifact?.diffStat?.trim() || '无';
      const untracked = artifact?.untrackedFiles?.length
        ? artifact.untrackedFiles.join(', ')
        : '无';

      return `${repository.name} [${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}] diffStat=${diffStat}; untracked=${untracked}`;
    });

    return [
      'Codex execution finished without producing any code changes.',
      `Plan filesToModify: ${input.plan.filesToModify.join(', ') || '无'}`,
      `Plan newFiles: ${input.plan.newFiles.join(', ') || '无'}`,
      `Plan implementation steps: ${input.plan.implementationPlan.join(' | ') || '无'}`,
      `All planned files: ${planFiles.join(', ') || '无'}`,
      `Repositories inspected: ${repositoryLines.join(' || ') || '无'}`,
      input.humanFeedback ? `Human feedback: ${input.humanFeedback}` : 'Human feedback: 无',
    ].join(' ');
  }

  private async getRepositoryStatus(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['status', '--porcelain=v1', '-uall'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2);
        const rawPath = line.slice(3).trim();
        const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;
        const changeType =
          status.includes('?') || status.includes('A') ? 'create' : 'update';

        return {
          path,
          changeType: changeType as 'create' | 'update',
        };
      });
  }

  private buildExecutionArtifactSection(
    artifacts: ExecuteTaskOutput['diffArtifacts'],
  ) {
    return artifacts
      .map((artifact) => {
        const parts = [
          `- ${artifact.repository} | 工作分支: ${artifact.branch}`,
        ];

        if (artifact.diffStat) {
          parts.push(`  diff --stat:\n${artifact.diffStat}`);
        }

        if (artifact.untrackedFiles.length > 0) {
          parts.push(
            `  未跟踪文件:\n${artifact.untrackedFiles.map((file) => `    - ${file}`).join('\n')}`,
          );
        }

        if (artifact.diffText) {
          parts.push(`  diff:\n${artifact.diffText}`);
        }

        return parts.join('\n');
      })
      .join('\n');
  }

  private getReadableRepositoryDirs(repositories?: RepositoryContext[] | null) {
    return (repositories ?? [])
      .filter((repository) => repository.localPath && repository.syncStatus === 'READY')
      .map((repository) => repository.localPath!);
  }

  private async getGitDiffStat(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['diff', '--stat', 'HEAD'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return stdout.trim();
  }

  private async getGitDiffText(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['diff', '--no-ext-diff', '--unified=3', 'HEAD'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
      },
    );
    return stdout.trim();
  }

  private async getUntrackedFiles(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private truncateText(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}\n...[truncated]`;
  }
}
