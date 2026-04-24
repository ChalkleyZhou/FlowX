import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { CodexAiExecutor } from './codex-ai.executor';
import { type AIInvocationContext } from './ai-executor';

const CURSOR_TIMEOUT_MS = Number(process.env.CURSOR_TIMEOUT_MS?.trim()) || 600_000;
const CURSOR_DESIGN_TIMEOUT_MS = Number(process.env.CURSOR_DESIGN_TIMEOUT_MS?.trim()) || CURSOR_TIMEOUT_MS;
const CURSOR_DEMO_WALL_TIMEOUT_MS = Number(process.env.CURSOR_DEMO_WALL_TIMEOUT_MS?.trim()) || 1_200_000;
const CURSOR_NO_PROGRESS_TIMEOUT_MS = Number(process.env.CURSOR_NO_PROGRESS_TIMEOUT_MS?.trim()) || 0;
const CURSOR_DEBUG_ROOT = join(process.cwd(), '.flowx-data', 'cursor-debug');
const CURSOR_MODEL = process.env.CURSOR_MODEL?.trim();
const CURSOR_AUTH_ERROR_PATTERNS = [
  /starting login process/i,
  /secitemcopymatching failed/i,
  /not authenticated/i,
  /authentication failed/i,
  /run .*login/i,
];

@Injectable()
export class CursorAiExecutor extends CodexAiExecutor {
  private readonly cursorLogger = new Logger(CursorAiExecutor.name);
  protected override readonly providerName = 'cursor';
  protected override readonly providerLabel = 'Cursor';
  protected override readonly debugRoot = CURSOR_DEBUG_ROOT;

  protected override async runJsonStage<T>(
    _schemaFile: string,
    prompt: string,
    stageName: string,
    addDirs: string[] = [],
    context?: AIInvocationContext,
  ): Promise<T> {
    const tempCwd = addDirs[0] ? null : await mkdtemp(join(tmpdir(), 'flowx-cursor-json-'));
    // Avoid using the FlowX service repo as implicit context when no target repo is provided.
    const cursorCwd = addDirs[0] ?? tempCwd!;
    const demoFlow = this.isDemoGenerationPrompt(prompt);
    const outputFormat = demoFlow ? 'text' : 'json';
    const args = ['-p', '--trust', '--output-format', outputFormat];
    if (CURSOR_MODEL) {
      args.push('--model', CURSOR_MODEL);
    }
    args.push(prompt);

    try {
      const timeoutMs = this.resolveStageTimeoutMs(stageName, prompt);
      const { stdout, stderr } = await this.runCursorProcess(
        args,
        cursorCwd,
        stageName,
        timeoutMs,
        prompt,
        context,
      );
      if (demoFlow) {
        return this.parseCursorJsonResult<T>(stdout);
      }
      const payload = JSON.parse(stdout.trim()) as {
        result?: string;
        subtype?: string;
        is_error?: boolean;
      };

      if (payload.is_error || payload.subtype !== 'success' || !payload.result?.trim()) {
        throw new Error(`Cursor returned invalid JSON envelope. stderr=${stderr}`);
      }

      return this.parseCursorJsonResult<T>(payload.result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Cursor error';
      this.cursorLogger.error(`Cursor ${stageName} failed: ${message}`);
      throw new Error(`Cursor ${stageName} failed: ${message}`);
    } finally {
      if (tempCwd) {
        await rm(tempCwd, { recursive: true, force: true });
      }
    }
  }

  protected override async runMutationStage(
    cwd: string,
    prompt: string,
    stageName: string,
    context?: AIInvocationContext,
  ) {
    const args = ['-p', '--trust', '--force', '--output-format', 'text'];
    if (CURSOR_MODEL) {
      args.push('--model', CURSOR_MODEL);
    }
    args.push(prompt);

    try {
      const timeoutMs = this.resolveStageTimeoutMs(stageName, prompt);
      await this.runCursorProcess(args, cwd, stageName, timeoutMs, prompt, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Cursor mutation error';
      this.cursorLogger.error(`Cursor ${stageName} failed: ${message}`);
      throw new Error(`Cursor ${stageName} failed: ${message}`);
    }
  }

  private async runCursorProcess(
    args: string[],
    cwd: string,
    stageName: string,
    timeoutMs: number,
    prompt?: string,
    context?: AIInvocationContext,
  ) {
    const invocation = await this.resolveCursorInvocation();

    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let firstOutputLogged = false;
      const createdAt = new Date().toISOString();
      const timestamp = createdAt.replace(/[:.]/g, '-');
      const stageSlug = stageName.replace(/[^a-z0-9-_]+/gi, '-');
      const artifactPath = join(this.debugRoot, `${timestamp}-${stageSlug}.json`);
      const persistArtifact = (payload: Record<string, unknown>) =>
        this.persistDebugArtifact(artifactPath, {
          provider: this.providerName,
          stageName,
          cwd,
          command: invocation.command,
          args: [...invocation.prefixArgs, ...args],
          prompt,
          createdAt,
          ...payload,
        });

      void persistArtifact({ status: 'STARTED' }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.cursorLogger.warn(`Failed to persist Cursor debug artifact: ${message}`);
      });

      const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
        cwd,
        env: this.buildCursorInvocationEnv(context),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        if (noProgressTimer) {
          clearTimeout(noProgressTimer);
        }
        child.kill('SIGTERM');
        void persistArtifact({
          status: 'TIMED_OUT',
          finishedAt: new Date().toISOString(),
          stdout,
          stderr,
          errorMessage: `Cursor ${stageName} timed out after ${timeoutMs}ms.`,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.cursorLogger.warn(`Failed to persist timed out Cursor artifact: ${message}`);
        });
        reject(new Error(`Cursor ${stageName} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);


      let noProgressTimer: ReturnType<typeof setTimeout> | null = null;
      const resetNoProgressTimer = () => {
        if (CURSOR_NO_PROGRESS_TIMEOUT_MS <= 0) {
          return;
        }
        if (noProgressTimer) {
          clearTimeout(noProgressTimer);
        }
        noProgressTimer = setTimeout(() => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timeout);
          if (noProgressTimer) {
            clearTimeout(noProgressTimer);
          }
          child.kill('SIGTERM');
          const errorMessage = `Cursor ${stageName} showed no progress for ${CURSOR_NO_PROGRESS_TIMEOUT_MS}ms (likely hung).`;
          void persistArtifact({
            status: 'FAILED',
            finishedAt: new Date().toISOString(),
            stdout,
            stderr,
            errorMessage,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.cursorLogger.warn(`Failed to persist no-progress Cursor artifact: ${message}`);
          });
          reject(new Error(errorMessage));
        }, CURSOR_NO_PROGRESS_TIMEOUT_MS);
      };
      resetNoProgressTimer();

      const sanitizePreview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 180);
      const maybeLogProgress = () => {
        if ((stdoutBytes + stderrBytes) % 32768 < 2048) {
          this.cursorLogger.log(
            `Cursor ${stageName} streaming progress cwd=${cwd} stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes}`,
          );
        }
      };

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBytes += Buffer.byteLength(text);
        if (!firstOutputLogged) {
          firstOutputLogged = true;
          this.cursorLogger.log(
            `Cursor ${stageName} first stdout received cwd=${cwd} preview="${sanitizePreview(text)}"`,
          );
        }
        maybeLogProgress();
        resetNoProgressTimer();
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        stderrBytes += Buffer.byteLength(text);
        if (!firstOutputLogged) {
          firstOutputLogged = true;
          this.cursorLogger.log(
            `Cursor ${stageName} first stderr received cwd=${cwd} preview="${sanitizePreview(text)}"`,
          );
        }
        maybeLogProgress();
        resetNoProgressTimer();
        if (this.isCursorAuthenticationError(stderr)) {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timeout);
          if (noProgressTimer) {
            clearTimeout(noProgressTimer);
          }
          child.kill('SIGTERM');
          const errorMessage = this.buildCursorAuthErrorMessage(context);
          void persistArtifact({
            status: 'FAILED',
            finishedAt: new Date().toISOString(),
            stdout,
            stderr,
            errorMessage,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.cursorLogger.warn(`Failed to persist auth failure Cursor artifact: ${message}`);
          });
          reject(new Error(errorMessage));
        }
      });

      child.on('error', (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        if (noProgressTimer) {
          clearTimeout(noProgressTimer);
        }
        void persistArtifact({
          status: 'ERROR',
          finishedAt: new Date().toISOString(),
          stdout,
          stderr,
          errorMessage: error.message,
        }).catch((persistError) => {
          const message =
            persistError instanceof Error ? persistError.message : String(persistError);
          this.cursorLogger.warn(`Failed to persist errored Cursor artifact: ${message}`);
        });
        reject(error);
      });

      child.on('close', (code) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        if (noProgressTimer) {
          clearTimeout(noProgressTimer);
        }
        if (code === 0) {
          void persistArtifact({
            status: 'COMPLETED',
            finishedAt: new Date().toISOString(),
            exitCode: code,
            stdout,
            stderr,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.cursorLogger.warn(`Failed to persist completed Cursor artifact: ${message}`);
          });
          resolve({ stdout, stderr });
          return;
        }

        void persistArtifact({
          status: 'FAILED',
          finishedAt: new Date().toISOString(),
          exitCode: code,
          stdout,
          stderr,
          errorMessage: `Cursor process exited with code ${code}. stderr=${stderr.trim() || 'empty'}`,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.cursorLogger.warn(`Failed to persist failed Cursor artifact: ${message}`);
        });

        reject(
          new Error(
            `Cursor process exited with code ${code}. stderr=${stderr.trim() || 'empty'}`,
          ),
        );
      });
    });
  }

  private resolveStageTimeoutMs(stageName: string, prompt?: string): number {
    if (this.isDemoGenerationPrompt(prompt)) {
      return CURSOR_DEMO_WALL_TIMEOUT_MS;
    }
    const normalized = stageName.trim().toLowerCase();
    if (normalized.includes('design')) {
      return CURSOR_DESIGN_TIMEOUT_MS;
    }
    return CURSOR_TIMEOUT_MS;
  }

  private isDemoGenerationPrompt(prompt?: string): boolean {
    if (!prompt) {
      return false;
    }
    const normalized = prompt.toLowerCase();
    return (
      normalized.includes('demopages') ||
      normalized.includes('demo pages') ||
      normalized.includes('demo 页面') ||
      normalized.includes('生成 demo') ||
      normalized.includes('仅生成 demo')
    );
  }

  private async resolveCursorInvocation() {
    if (await this.commandExists('agent')) {
      return { command: 'agent', prefixArgs: [] as string[] };
    }

    if (await this.commandExists('cursor-agent')) {
      return { command: 'cursor-agent', prefixArgs: [] as string[] };
    }

    if (await this.commandExists('cursor')) {
      return { command: 'cursor', prefixArgs: ['agent'] };
    }

    throw new Error(
      'Cursor CLI is not installed. Expected one of `agent`, `cursor-agent`, or `cursor` to be available in PATH.',
    );
  }

  private async commandExists(command: string) {
    const pathValue = process.env.PATH ?? '';
    const candidates = pathValue
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => join(entry, command));

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private isCursorAuthenticationError(stderr: string) {
    return CURSOR_AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(stderr));
  }

  private buildCursorInvocationEnv(context?: AIInvocationContext) {
    if (!context?.cursorApiKey) {
      return process.env;
    }

    return {
      ...process.env,
      CURSOR_API_KEY: context.cursorApiKey,
    };
  }

  private buildCursorAuthErrorMessage(context?: AIInvocationContext) {
    if (context?.cursorCredentialSource === 'organization') {
      return 'CURSOR_AUTH_INVALID_ORG_KEY: Cursor authentication failed for organization-scoped credential. Please update your organization Cursor API Key.';
    }
    if (context?.cursorCredentialSource === 'instance') {
      return 'CURSOR_AUTH_INVALID_INSTANCE_KEY: Cursor authentication failed for instance CURSOR_API_KEY. Please rotate server credential.';
    }
    return 'CURSOR_AUTH_MISSING: Cursor authentication failed. Re-run `agent login` (or `cursor agent login`) on the server, or provide CURSOR_API_KEY.';
  }

  private parseCursorJsonResult<T>(result: string): T {
    const trimmed = result.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      const candidates = this.extractJsonCandidates(trimmed);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        try {
          return JSON.parse(candidates[index]!) as T;
        } catch {
          continue;
        }
      }

      throw new Error(`Cursor result did not contain JSON. Result preview=${trimmed.slice(0, 200)}`);
    }
  }

  private extractJsonCandidates(input: string) {
    const candidates: string[] = [];
    const stack: string[] = [];
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
      const char = input[index]!;

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{' || char === '[') {
        if (stack.length === 0) {
          start = index;
        }
        stack.push(char);
        continue;
      }

      if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        if (stack[stack.length - 1] !== expected) {
          stack.length = 0;
          start = -1;
          continue;
        }

        stack.pop();
        if (stack.length === 0 && start !== -1) {
          candidates.push(input.slice(start, index + 1));
          start = -1;
        }
      }
    }

    return candidates;
  }

  protected override async persistDebugArtifact(
    artifactPath: string,
    payload: Record<string, unknown>,
  ) {
    await mkdir(this.debugRoot, { recursive: true });
    await writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
