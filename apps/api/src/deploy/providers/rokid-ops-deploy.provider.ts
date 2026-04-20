import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeployCreateJobResult,
  DeployPreviewResult,
  DeployProvider,
  DeployResolvedJobInput,
} from './deploy-provider.interface';

@Injectable()
export class RokidOpsDeployProvider implements DeployProvider {
  readonly id = 'rokid-ops';
  readonly label = 'Rokid OPS';
  private readonly logger = new Logger(RokidOpsDeployProvider.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(this.getCreateJobUrl());
  }

  async preview(input: DeployResolvedJobInput): Promise<DeployPreviewResult> {
    return {
      provider: this.id,
      payload: this.buildPayload(input),
    };
  }

  async createJob(input: DeployResolvedJobInput): Promise<DeployCreateJobResult> {
    const url = this.getCreateJobUrl();
    if (!url) {
      throw new Error('Rokid OPS createJob URL is not configured.');
    }

    const payload = this.buildPayload(input);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.buildHeaders(),
    };
    const body = JSON.stringify(payload);
    this.logger.log(
      `Rokid OPS createJob request: ${JSON.stringify({
        method: 'POST',
        url,
        headers: this.redactHeadersForLog(headers),
        body: payload,
      })}`,
    );
    const timeoutMs = Number(this.configService.get<string>('DEPLOY_PROVIDER_TIMEOUT_MS') ?? 10000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const responsePayload = this.safeParseJson(responseText);

      if (!response.ok) {
        throw new Error(
          `Rokid OPS createJob failed with status ${response.status}: ${this.stringifyPayload(responsePayload)}`,
        );
      }

      const businessCode = this.readBusinessCode(responsePayload);
      if (businessCode !== null && businessCode !== 0) {
        const businessMessage =
          this.pickString(
            this.readField(responsePayload, 'message'),
            this.readField(responsePayload, 'msg'),
            this.readField(responsePayload, 'data'),
          ) || this.stringifyPayload(responsePayload);
        throw new Error(`Rokid OPS createJob failed: ${businessMessage}`);
      }

      return {
        provider: this.id,
        payload,
        externalJobId: this.pickString(
          this.readField(responsePayload, 'jobId'),
          this.readField(responsePayload, 'id'),
          this.readField(responsePayload, 'buildId'),
        ),
        externalJobUrl: this.pickString(
          this.readField(responsePayload, 'jobUrl'),
          this.readField(responsePayload, 'url'),
          this.readField(responsePayload, 'link'),
        ),
        response: responsePayload,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rokid OPS createJob request failed: ${message}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPayload(input: DeployResolvedJobInput) {
    const payload: Record<string, unknown> = {
      ...input.config,
      ...input.overrides,
    };

    if (input.env?.trim()) {
      payload.env = input.env.trim();
    }
    if (input.version?.trim()) {
      payload.version = input.version.trim();
    }
    if (input.versionImage?.trim()) {
      payload.version_image = input.versionImage.trim();
    }
    if (input.commit?.trim()) {
      payload.commit = input.commit.trim();
    }
    if (input.branch?.trim()) {
      payload.BRANCH = input.branch.trim();
    }
    if (input.image?.trim()) {
      payload.image = input.image.trim();
    }

    return payload;
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.configService.get<string>('DEPLOY_ROKID_OPS_API_KEY')?.trim();
    if (!apiKey) {
      return {};
    }

    return {
      'API-KEY': apiKey,
    };
  }

  /** Log-safe copy: never prints full API key. */
  private redactHeadersForLog(headers: Record<string, string>): Record<string, string> {
    const copy = { ...headers };
    const key = copy['API-KEY'];
    if (key) {
      copy['API-KEY'] =
        key.length <= 4 ? '(redacted)' : `(redacted, len=${key.length}, suffix=...${key.slice(-4)})`;
    }
    return copy;
  }

  private getCreateJobUrl() {
    return (
      this.configService.get<string>('DEPLOY_ROKID_OPS_CREATE_JOB_URL')?.trim() ||
      this.configService.get<string>('DEPLOY_PROVIDER_BASE_URL')?.trim() ||
      ''
    );
  }

  private safeParseJson(value: string) {
    if (!value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private readField(value: unknown, key: string) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }

  private readBusinessCode(value: unknown) {
    const code = this.readField(value, 'code');
    if (typeof code === 'number' && Number.isFinite(code)) {
      return code;
    }
    if (typeof code === 'string' && code.trim()) {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  }

  private stringifyPayload(payload: unknown) {
    if (typeof payload === 'string') {
      return payload;
    }

    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }
}
