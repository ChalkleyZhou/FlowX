import { Injectable } from '@nestjs/common';
import {
  DeployCreateJobResult,
  DeployPreviewResult,
  DeployProvider,
  DeployResolvedJobInput,
} from './deploy-provider.interface';

@Injectable()
export class NoopDeployProvider implements DeployProvider {
  readonly id = 'noop';
  readonly label = 'No-op Deploy';

  async preview(input: DeployResolvedJobInput): Promise<DeployPreviewResult> {
    return {
      provider: this.id,
      payload: this.buildPayload(input),
    };
  }

  async createJob(input: DeployResolvedJobInput): Promise<DeployCreateJobResult> {
    const payload = this.buildPayload(input);

    return {
      provider: this.id,
      payload,
      externalJobId: null,
      externalJobUrl: null,
      response: {
        mode: 'noop',
        message: 'No deploy provider is configured. Request recorded only.',
      },
    };
  }

  private buildPayload(input: DeployResolvedJobInput) {
    return {
      ...input.config,
      ...input.overrides,
      env: input.env ?? input.config.env ?? null,
      branch: input.branch ?? null,
      commit: input.commit ?? null,
      version: input.version ?? null,
      versionImage: input.versionImage ?? null,
      image: input.image ?? null,
    };
  }
}
