import { Injectable } from '@nestjs/common';
import { ExternalIntegrationsService } from './external-integrations.service';
import type { BuiltInPlugin, BuiltInPluginUpdateOptions } from './plugin.types';

@Injectable()
export class YunxiaoPlugin implements BuiltInPlugin {
  readonly id = 'yunxiao';
  readonly name = '云效';

  constructor(private readonly integrations: ExternalIntegrationsService) {}

  getStatus(organizationId: string) {
    return this.integrations.getYunxiaoStatus(organizationId);
  }

  updateStatus(
    organizationId: string,
    actingUserId: string,
    enabled: boolean,
    options?: BuiltInPluginUpdateOptions,
  ) {
    return this.integrations.updateYunxiaoStatus(organizationId, actingUserId, enabled, options);
  }

  isEnabled(organizationId: string) {
    return this.integrations.isYunxiaoEnabled(organizationId);
  }
}
