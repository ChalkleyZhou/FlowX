import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FlowXTaskItem, LocalDesignSubmission } from './flowx-client';

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/** Read the agent-written design output file from the workspace, if present. */
export async function readLocalDesignFile(gitRoot: string, runId: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(gitRoot, localDesignRelPath(runId)), 'utf8');
  } catch {
    return null;
  }
}

/** Workspace-relative path where the local agent must write the generated design output. */
export function localDesignRelPath(runId: string): string {
  return `.flowx/design/${sanitize(runId)}.json`;
}

/** Prompt handed to the local agent (with OpenDesign MCP) to generate the design and write it to disk. */
export function buildLocalDesignPrompt(task: FlowXTaskItem, runId: string, relFilePath: string): string {
  const taskLabel = task.type === 'bug' ? 'Bug' : 'Requirement';
  return [
    `# FlowX 本地设计生成（OpenDesign MCP）: ${task.title.trim()}`,
    '',
    '## 上下文',
    `- ${taskLabel} id: ${task.id}`,
    `- Workflow run id: ${runId}`,
    '',
    '## 任务',
    '请使用 OpenDesign MCP 工具为该需求生成一份高保真、自包含的单页 HTML 设计稿：',
    '- 用 `od get-file design-systems/<system>/DESIGN.md` 读取目标设计系统，用 `od skill list` / `od search-files` 找匹配场景；',
    '- designArtifact.html 必须是完整 HTML 文档（<!doctype html> 起始，样式内联，无外部资源依赖），可在 sandbox iframe 直接渲染。',
    '',
    '## 输出（关键）',
    `把结果写入工作区文件 \`${relFilePath}\`，内容为单个 JSON 对象，结构如下（不要写 Markdown 或代码围栏，只写 JSON）：`,
    '```json',
    '{',
    '  "design": { "overview": "...", "pages": [{ "name": "...", "route": "...", "layout": "...", "keyComponents": [], "interactions": [] }], "demoScenario": "...", "designRationale": "..." },',
    '  "demo": { "summary": "...", "flows": [{ "name": "...", "goal": "...", "entry": "...", "states": [] }], "scope": { "included": [], "excluded": [] }, "knownGaps": [] },',
    '  "designArtifact": { "html": "<!doctype html>..." }',
    '}',
    '```',
    '写完文件后，回到 FlowX 扩展，对该任务执行「提交本地设计」。',
  ].join('\n');
}

export interface GenerateLocalDesignDeps {
  getGitRoot(): Promise<string | null>;
  buildPrompt(task: FlowXTaskItem, runId: string, relFilePath: string): string;
  copyToClipboard(content: string): Promise<void>;
  openPromptInChat(prompt: string): Promise<boolean>;
  showError(message: string): void;
  showInfo(message: string): void;
}

export async function generateLocalDesign(deps: GenerateLocalDesignDeps, task: FlowXTaskItem): Promise<void> {
  if (!task.workflowRunId) {
    deps.showError('该任务没有关联的 workflow run。');
    return;
  }
  const gitRoot = await deps.getGitRoot();
  if (!gitRoot) {
    deps.showError('请先打开本地 Git 工作区，再用 OpenDesign 本地生成设计。');
    return;
  }
  const relPath = localDesignRelPath(task.workflowRunId);
  const prompt = deps.buildPrompt(task, task.workflowRunId, relPath);
  await deps.copyToClipboard(prompt);
  const opened = await deps.openPromptInChat(prompt);
  deps.showInfo(
    opened
      ? `已把设计生成提示词打开到 Chat。让 agent 用 OpenDesign MCP 生成并写入 ${relPath}，完成后点「提交本地设计」。`
      : `已复制设计生成提示词。让 agent 用 OpenDesign MCP 生成并写入 ${relPath}，完成后点「提交本地设计」。`,
  );
}

export interface SubmitLocalDesignDeps {
  getGitRoot(): Promise<string | null>;
  readDesignFile(gitRoot: string, runId: string): Promise<string | null>;
  submit(runId: string, body: LocalDesignSubmission): Promise<unknown>;
  showError(message: string): void;
  showInfo(message: string): void;
}

/** Read the agent-written design JSON, validate the top-level shape, and submit it to FlowX. */
export async function submitLocalDesignFromFile(deps: SubmitLocalDesignDeps, runId: string): Promise<void> {
  const gitRoot = await deps.getGitRoot();
  if (!gitRoot) {
    deps.showError('请先打开本地 Git 工作区。');
    return;
  }
  const raw = await deps.readDesignFile(gitRoot, runId);
  if (!raw) {
    deps.showError(`未找到本地设计产物 ${localDesignRelPath(runId)}，请先运行「本地生成设计」让 agent 写出该文件。`);
    return;
  }

  const body = parseLocalDesignSubmission(raw);
  if (!body) {
    deps.showError('本地设计产物无效：需要包含 design、demo 以及非空的 designArtifact.html。');
    return;
  }

  await deps.submit(runId, body);
  deps.showInfo('本地设计已提交，进入确认环节。');
}

/** Parse + shape-check the agent output. Returns null when the shape is invalid. */
export function parseLocalDesignSubmission(raw: string): LocalDesignSubmission | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const design = record.design;
  const demo = record.demo;
  const designArtifact = record.designArtifact as Record<string, unknown> | undefined;
  const html = designArtifact?.html;
  if (
    !design ||
    typeof design !== 'object' ||
    !demo ||
    typeof demo !== 'object' ||
    !designArtifact ||
    typeof designArtifact !== 'object' ||
    typeof html !== 'string' ||
    html.trim().length === 0
  ) {
    return null;
  }
  return {
    design: design as Record<string, unknown>,
    demo: demo as Record<string, unknown>,
    designArtifact: designArtifact as { html: string } & Record<string, unknown>,
  };
}
