import { Injectable } from '@nestjs/common';
import { ExternalIntegrationsService } from './external-integrations.service';
import type {
  BuiltInPlugin,
  BuiltInPluginUpdateOptions,
  YunxiaoMemberMappingInput,
} from './plugin.types';

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

  getUnmatchedRecipients(organizationId: string) {
    return this.integrations.listYunxiaoUnmatchedRecipients(organizationId);
  }

  getProjectMembers(organizationId: string, projectId: string) {
    return this.integrations.listYunxiaoProjectMembers(organizationId, projectId);
  }

  setMemberMapping(
    organizationId: string,
    actingUserId: string,
    input: YunxiaoMemberMappingInput,
  ) {
    return this.integrations.setYunxiaoMemberMapping(
      organizationId,
      actingUserId,
      input,
    );
  }
}
