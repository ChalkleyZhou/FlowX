import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { CodexAiExecutor } from './codex-ai.executor';

const CURSOR_TIMEOUT_MS = Number(process.env.CURSOR_TIMEOUT_MS?.trim()) || 600_000;
const CURSOR_DEBUG_ROOT = join(process.cwd(), '.flowx-data', 'cursor-debug');
const CURSOR_MODEL = process.env.CURSOR_MODEL?.trim();

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
  ): Promise<T> {
    const cursorCwd = addDirs[0] ?? process.cwd();
    const args = ['-p', '--output-format', 'json'];
    if (CURSOR_MODEL) {
      args.push('--model', CURSOR_MODEL);
    }
    args.push(prompt);

    try {
      const { stdout, stderr } = await this.runCursorProcess(args, cursorCwd, stageName, prompt);
      const payload = JSON.parse(stdout.trim()) as {
        result?: string;
        subtype?: string;
        is_error?: boolean;
      };

      if (payload.is_error || payload.subtype !== 'success' || !payload.result?.trim()) {
        throw new Error(`Cursor returned invalid JSON envelope. stderr=${stderr}`);
      }

      return JSON.parse(payload.result) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Cursor error';
      this.cursorLogger.error(`Cursor ${stageName} failed: ${message}`);
      throw new Error(`Cursor ${stageName} failed: ${message}`);
    }
  }

  protected override async runMutationStage(cwd: string, prompt: string, stageName: string) {
    const args = ['-p', '--force', '--output-format', 'text'];
    if (CURSOR_MODEL) {
      args.push('--model', CURSOR_MODEL);
    }
    args.push(prompt);

    try {
      await this.runCursorProcess(args, cwd, stageName, prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Cursor mutation error';
      this.cursorLogger.error(`Cursor ${stageName} failed: ${message}`);
      throw new Error(`Cursor ${stageName} failed: ${message}`);
    }
  }

  private runCursorProcess(
    args: string[],
    cwd: string,
    stageName: string,
    prompt?: string,
  ) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      const createdAt = new Date().toISOString();
      const timestamp = createdAt.replace(/[:.]/g, '-');
      const stageSlug = stageName.replace(/[^a-z0-9-_]+/gi, '-');
      const artifactPath = join(this.debugRoot, `${timestamp}-${stageSlug}.json`);
      const persistArtifact = (payload: Record<string, unknown>) =>
        this.persistDebugArtifact(artifactPath, {
          provider: this.providerName,
          stageName,
          cwd,
          args,
          prompt,
          createdAt,
          ...payload,
        });

      void persistArtifact({ status: 'STARTED' }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.cursorLogger.warn(`Failed to persist Cursor debug artifact: ${message}`);
      });

      const child = spawn('cursor-agent', args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        child.kill('SIGTERM');
        void persistArtifact({
          status: 'TIMED_OUT',
          finishedAt: new Date().toISOString(),
          stdout,
          stderr,
          errorMessage: `Cursor ${stageName} timed out after ${CURSOR_TIMEOUT_MS}ms.`,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.cursorLogger.warn(`Failed to persist timed out Cursor artifact: ${message}`);
        });
        reject(new Error(`Cursor ${stageName} timed out after ${CURSOR_TIMEOUT_MS}ms.`));
      }, CURSOR_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
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

  protected override async persistDebugArtifact(
    artifactPath: string,
    payload: Record<string, unknown>,
  ) {
    await mkdir(this.debugRoot, { recursive: true });
    await writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
