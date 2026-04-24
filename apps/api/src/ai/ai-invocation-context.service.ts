import { Injectable, Logger } from '@nestjs/common';
import { AiCredentialsService } from '../auth/ai-credentials.service';
import type { AIExecutorProvider, AIInvocationContext } from './ai-executor';

function parseAiExecutorProvider(provider?: string | null): AIExecutorProvider | null {
  const candidate = provider?.trim().toLowerCase();
  if (candidate === 'cursor') {
    return 'cursor';
  }
  if (candidate === 'codex') {
    return 'codex';
  }
  return null;
}

export function resolveConfiguredDefaultAiProviderFromEnv(): AIExecutorProvider {
  return (
    parseAiExecutorProvider(process.env.AI_EXECUTOR_DEFAULT_PROVIDER ?? process.env.AI_EXECUTOR_PROVIDER) ?? 'codex'
  );
}

export type AiInvocationRecipient = {
  flowxUserId: string;
  flowxOrganizationId?: string | null;
  displayName: string;
  providerOrganizationId?: string | null;
  organizationName?: string | null;
};

@Injectable()
export class AiInvocationContextService {
  private readonly logger = new Logger(AiInvocationContextService.name);
  private readonly configuredDefaultAiProvider = resolveConfiguredDefaultAiProviderFromEnv();
  private readonly requireUserCursorCredential = this.parseBooleanEnv(
    process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL,
  );
  private readonly requireUserCodexCredential = this.parseBooleanEnv(
    process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL,
  );

  constructor(private readonly aiCredentialsService: AiCredentialsService) {}

  getConfiguredDefaultProvider(): AIExecutorProvider {
    return this.configuredDefaultAiProvider;
  }

  normalizeAiProvider(provider?: string | null): AIExecutorProvider {
    const parsed = parseAiExecutorProvider(provider);
    if (parsed) {
      return parsed;
    }
    return this.configuredDefaultAiProvider ?? 'codex';
  }

  async resolveInvocationContext(
    provider: string | null | undefined,
    recipient?: AiInvocationRecipient | null,
  ): Promise<AIInvocationContext> {
    const context: AIInvocationContext = {
      requestUserId: recipient?.flowxUserId,
      requestUserDisplayName: recipient?.displayName,
    };

    const normalizedProvider = this.normalizeAiProvider(provider);
    if (normalizedProvider === 'codex') {
      return this.resolveCodexInvocationContext(context, recipient);
    }

    if (normalizedProvider !== 'cursor') {
      return context;
    }

    if (recipient?.flowxOrganizationId) {
      try {
        const organizationApiKey = await this.aiCredentialsService.getCursorApiKeyForOrganization(
          recipient.flowxOrganizationId,
        );
        if (organizationApiKey) {
          context.cursorApiKey = organizationApiKey;
          context.cursorCredentialSource = 'organization';
          this.logger.log(
            `Cursor credential source=organization for organization ${recipient.flowxOrganizationId}.`,
          );
          return context;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `CURSOR_CREDENTIAL_DECRYPT_FAILED organization=${recipient.flowxOrganizationId} message=${message}`,
        );
        throw new Error(
          'CURSOR_CREDENTIAL_DECRYPT_FAILED: Failed to decrypt organization Cursor credential.',
        );
      }
    }

    if (this.requireUserCursorCredential) {
      const organizationId = recipient?.flowxOrganizationId ?? 'unknown';
      this.logger.warn(`CURSOR_ORGANIZATION_CREDENTIAL_REQUIRED organization=${organizationId}`);
      throw new Error(
        'CURSOR_ORGANIZATION_CREDENTIAL_REQUIRED: This workspace requires organization-level Cursor credentials. Please configure your organization Cursor API Key first.',
      );
    }

    if (process.env.CURSOR_API_KEY?.trim()) {
      context.cursorCredentialSource = 'instance';
      this.logger.log(
        `Cursor credential source=instance for organization ${recipient?.flowxOrganizationId ?? 'unknown'}.`,
      );
      return context;
    }

    context.cursorCredentialSource = 'login-state';
    this.logger.log(
      `Cursor credential source=login-state for organization ${recipient?.flowxOrganizationId ?? 'unknown'}.`,
    );
    return context;
  }

  private async resolveCodexInvocationContext(
    context: AIInvocationContext,
    recipient?: AiInvocationRecipient | null,
  ): Promise<AIInvocationContext> {
    if (recipient?.flowxOrganizationId) {
      try {
        const organizationApiKey = await this.aiCredentialsService.getCodexApiKeyForOrganization(
          recipient.flowxOrganizationId,
        );
        if (organizationApiKey) {
          context.codexApiKey = organizationApiKey;
          context.codexCredentialSource = 'organization';
          this.logger.log(
            `Codex credential source=organization for organization ${recipient.flowxOrganizationId}.`,
          );
          return context;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `CODEX_CREDENTIAL_DECRYPT_FAILED organization=${recipient.flowxOrganizationId} message=${message}`,
        );
        throw new Error(
          'CODEX_CREDENTIAL_DECRYPT_FAILED: Failed to decrypt organization Codex credential.',
        );
      }
    }

    if (this.requireUserCodexCredential) {
      const organizationId = recipient?.flowxOrganizationId ?? 'unknown';
      this.logger.warn(`CODEX_ORGANIZATION_CREDENTIAL_REQUIRED organization=${organizationId}`);
      throw new Error(
        'CODEX_ORGANIZATION_CREDENTIAL_REQUIRED: This workspace requires organization-level Codex credentials. Please configure your organization OpenAI API Key first.',
      );
    }

    if (process.env.OPENAI_API_KEY?.trim()) {
      context.codexCredentialSource = 'instance';
      this.logger.log(
        `Codex credential source=instance for organization ${recipient?.flowxOrganizationId ?? 'unknown'}.`,
      );
      return context;
    }

    context.codexCredentialSource = 'login-state';
    this.logger.log(
      `Codex credential source=login-state for organization ${recipient?.flowxOrganizationId ?? 'unknown'}.`,
    );
    return context;
  }

  private parseBooleanEnv(value?: string | null) {
    if (!value) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
}
