export interface BuiltInPluginUpdateOptions {
  yunxiaoOrganizationIdentifier?: string | null;
}

export interface BuiltInPlugin {
  id: string;
  name: string;
  getStatus(organizationId: string): Promise<unknown>;
  updateStatus(
    organizationId: string,
    actingUserId: string,
    enabled: boolean,
    options?: BuiltInPluginUpdateOptions,
  ): Promise<unknown>;
  getUnmatchedRecipients(organizationId: string): Promise<unknown>;
}
