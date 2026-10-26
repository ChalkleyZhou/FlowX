import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiCredentialsService, parseAiCredentialProvider } from '../auth/ai-credentials.service';
import type { AIExecutorProvider, AIInvocationContext } from './ai-executor';

export const ONLINE_AI_UNAVAILABLE_MESSAGE = '当前组织未配置 AI 凭据，在线 AI 不可用。';

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

  async listOnlineProviders(organizationId: string) {
    const policy = await this.aiCredentialsService.getOnlineAiPolicy(organizationId);
    return {
      defaultProvider: policy.defaultProvider,
      onlineAvailable: policy.onlineAvailable,
      providers: policy.providers
        .filter((provider) => provider.configured)
        .map((provider) => ({ id: provider.id, label: provider.label })),
    };
  }

  async resolveOnlineProvider(
    organizationId?: string | null,
    requested?: string | null,
  ): Promise<AIExecutorProvider> {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new BadRequestException(ONLINE_AI_UNAVAILABLE_MESSAGE);
    }
    const policy = await this.aiCredentialsService.getOnlineAiPolicy(orgId);
    const explicit = parseAiCredentialProvider(requested);
    if (explicit) {
      if (!policy.providers.some((provider) => provider.id === explicit && provider.configured)) {
        throw new BadRequestException(
          explicit === 'cursor'
            ? '当前组织未配置 Cursor 凭据，在线 AI 不可用。'
            : '当前组织未配置 Codex 凭据，在线 AI 不可用。',
        );
      }
      return explicit;
    }
    if (!policy.defaultProvider) {
      throw new BadRequestException(ONLINE_AI_UNAVAILABLE_MESSAGE);
    }
    return policy.defaultProvider;
  }

  async resolveInvocationContext(
    provider: string | null | undefined,
    recipient?: AiInvocationRecipient | null,
  ): Promise<AIInvocationContext> {
    const context: AIInvocationContext = {
      requestUserId: recipient?.flowxUserId,
      requestUserDisplayName: recipient?.displayName,
    };

    const normalizedProvider = parseAiExecutorProvider(provider);
    if (!normalizedProvider) {
      throw new BadRequestException(ONLINE_AI_UNAVAILABLE_MESSAGE);
    }
    if (normalizedProvider === 'codex') {
      return this.resolveCodexInvocationContext(context, recipient);
    }

    const organizationId = recipient?.flowxOrganizationId?.trim();
    if (!organizationId) {
      throw new BadRequestException('当前组织未配置 Cursor 凭据，在线 AI 不可用。');
    }
    try {
      const organizationApiKey = await this.aiCredentialsService.getCursorApiKeyForOrganization(organizationId);
      if (!organizationApiKey) {
        throw new BadRequestException('当前组织未配置 Cursor 凭据，在线 AI 不可用。');
      }
      context.cursorApiKey = organizationApiKey;
      context.cursorCredentialSource = 'organization';
      this.logger.log(`Cursor credential source=organization for organization ${organizationId}.`);
      return context;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`CURSOR_CREDENTIAL_DECRYPT_FAILED organization=${organizationId} message=${message}`);
      throw new Error('CURSOR_CREDENTIAL_DECRYPT_FAILED: Failed to decrypt organization Cursor credential.');
    }
  }

  private async resolveCodexInvocationContext(
    context: AIInvocationContext,
    recipient?: AiInvocationRecipient | null,
  ): Promise<AIInvocationContext> {
    const organizationId = recipient?.flowxOrganizationId?.trim();
    if (!organizationId) {
      throw new BadRequestException('当前组织未配置 Codex 凭据，在线 AI 不可用。');
    }
    try {
      const organizationApiKey = await this.aiCredentialsService.getCodexApiKeyForOrganization(organizationId);
      if (!organizationApiKey) {
        throw new BadRequestException('当前组织未配置 Codex 凭据，在线 AI 不可用。');
      }
      context.codexApiKey = organizationApiKey;
      context.codexCredentialSource = 'organization';
      this.logger.log(`Codex credential source=organization for organization ${organizationId}.`);
      return context;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`CODEX_CREDENTIAL_DECRYPT_FAILED organization=${organizationId} message=${message}`);
      throw new Error('CODEX_CREDENTIAL_DECRYPT_FAILED: Failed to decrypt organization Codex credential.');
    }
  }
}
