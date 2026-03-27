import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
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
    const parsed = await this.runCodexJson<SplitTasksOutput>(
      'task-split.output.schema.json',
      this.buildTaskSplitPrompt(input),
      'task split',
    );
    this.assertSplitTasksOutput(parsed);
    return parsed;
  }

  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanOutput> {
    return this.runCodexJson<GeneratePlanOutput>(
      'technical-plan.output.schema.json',
      this.buildTechnicalPlanPrompt(input),
      'technical plan',
    );
  }

  async executeTask(input: ExecuteTaskInput): Promise<ExecuteTaskOutput> {
    return this.runCodexJson<ExecuteTaskOutput>(
      'execution.output.schema.json',
      this.buildExecutionPrompt(input),
      'execution',
    );
  }

  async reviewCode(input: ReviewCodeInput): Promise<ReviewCodeOutput> {
    return this.runCodexJson<ReviewCodeOutput>(
      'review.output.schema.json',
      this.buildReviewPrompt(input),
      'review',
    );
  }

  private buildTaskSplitPrompt(input: SplitTasksInput) {
    const workspaceSection = this.buildWorkspaceSection(input.workspace);

    return `${taskSplitPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${taskSplitPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}

请输出:
1. tasks: 面向当前工作区代码库的可执行研发任务，尽量具体到模块或改动方向
2. ambiguities: 仍待人工确认的关键不明确点
3. risks: 该需求实施过程中的主要风险
`;
  }

  private buildTechnicalPlanPrompt(input: GeneratePlanInput) {
    const workspaceSection = this.buildWorkspaceSection(input.workspace);

    return `${technicalPlanPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${technicalPlanPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}

已确认任务:
${input.tasks.map((task, index) => `${index + 1}. ${task.title}: ${task.description}`).join('\n')}
`;
  }

  private buildExecutionPrompt(input: ExecuteTaskInput) {
    const workspaceSection = this.buildWorkspaceSection(input.workspace);

    return `${executionPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${executionPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}

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

  private buildReviewPrompt(input: ReviewCodeInput) {
    const workspaceSection = this.buildWorkspaceSection(input.workspace);

    return `${reviewPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${reviewPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}

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
`;
  }

  private buildWorkspaceSection(workspace?: {
    name: string;
    description?: string | null;
    repositories: RepositoryContext[];
  } | null) {
    if (!workspace) {
      return '\n工作区上下文:\n- 未提供工作区信息';
    }

    const repositories = workspace.repositories.length
      ? workspace.repositories
          .map(
            (repository) =>
              `  - ${repository.name} | URL: ${repository.url} | 默认分支: ${repository.defaultBranch ?? '未设置'} | 当前分支: ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}`,
          )
          .join('\n')
      : '  - 当前工作区未登记代码库';

    return `
工作区上下文:
- 名称: ${workspace.name}
- 描述: ${workspace.description ?? '无'}
- 代码库:
${repositories}`;
  }

  private assertSplitTasksOutput(output: SplitTasksOutput) {
    if (!Array.isArray(output.tasks) || output.tasks.length === 0) {
      throw new Error('Codex did not return any tasks.');
    }
    if (!Array.isArray(output.ambiguities) || !Array.isArray(output.risks)) {
      throw new Error('Codex output shape is invalid.');
    }
  }

  private async runCodexJson<T>(schemaFile: string, prompt: string, stageName: string): Promise<T> {
    const tempDir = await mkdtemp(join(tmpdir(), 'flowx-codex-'));
    const outputPath = join(tempDir, `${stageName.replace(/\s+/g, '-')}.json`);
    const schemaPath = join(this.schemaDir, schemaFile);

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
}
