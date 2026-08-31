export interface BuiltInPlugin {
  id: string;
  name: string;
  getStatus(organizationId: string): Promise<unknown>;
  updateStatus(
    organizationId: string,
    actingUserId: string,
    enabled: boolean,
  ): Promise<unknown>;
}
