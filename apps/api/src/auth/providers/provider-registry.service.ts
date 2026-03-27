import { Injectable, NotFoundException } from '@nestjs/common';
import { DingTalkAuthProvider } from './dingtalk.provider';
import { AuthProvider } from './auth-provider.interface';

@Injectable()
export class ProviderRegistryService {
  private readonly providers: Map<string, AuthProvider>;

  constructor(dingTalkProvider: DingTalkAuthProvider) {
    this.providers = new Map<string, AuthProvider>([[dingTalkProvider.name, dingTalkProvider]]);
  }

  listProviders() {
    return Array.from(this.providers.keys());
  }

  getProvider(name: string): AuthProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new NotFoundException(`Unsupported auth provider: ${name}`);
    }
    return provider;
  }
}

