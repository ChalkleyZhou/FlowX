import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeployProvider } from './deploy-provider.interface';
import { NoopDeployProvider } from './noop-deploy.provider';
import { RokidOpsDeployProvider } from './rokid-ops-deploy.provider';

@Injectable()
export class DeployProviderRegistryService {
  constructor(
    private readonly configService: ConfigService,
    private readonly noopProvider: NoopDeployProvider,
    private readonly rokidOpsProvider: RokidOpsDeployProvider,
  ) {}

  getDefaultProviderId() {
    return this.configService.get<string>('DEPLOY_PROVIDER')?.trim() || this.noopProvider.id;
  }

  listProviders() {
    const providers: DeployProvider[] = [this.noopProvider];

    if (this.rokidOpsProvider.isConfigured() || this.getDefaultProviderId() === this.rokidOpsProvider.id) {
      providers.push(this.rokidOpsProvider);
    }

    return providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
    }));
  }

  getProvider(providerId?: string | null): DeployProvider {
    const normalized = providerId?.trim() || this.getDefaultProviderId();

    if (normalized === this.rokidOpsProvider.id) {
      return this.rokidOpsProvider;
    }

    if (normalized === this.noopProvider.id) {
      return this.noopProvider;
    }

    return this.noopProvider;
  }
}
