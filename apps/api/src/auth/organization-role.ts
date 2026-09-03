export const ORGANIZATION_ROLES = ['admin', 'sub_admin', 'member'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'sub_admin';
}

export function isPrimaryOrganizationAdmin(role?: string | null): boolean {
  return role === 'admin';
}
