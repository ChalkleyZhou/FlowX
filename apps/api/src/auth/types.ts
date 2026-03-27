export interface ExternalOrganization {
  id: string;
  name: string;
  logoUrl?: string;
}

export interface ExternalUserProfile {
  userId: string;
  unionId?: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  raw?: unknown;
}

export interface ProviderAuthorizeUrlResult {
  url: string;
}

export interface OAuthExchangeResult {
  profile: ExternalUserProfile;
  organizations: ExternalOrganization[];
}

