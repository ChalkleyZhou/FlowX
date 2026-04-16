import { OAuthExchangeResult, ProviderAuthorizeUrlResult } from '../types';

export interface AuthProvider {
  readonly name: string;
  getAuthorizeUrl(input: { state: string; redirectUri: string }): ProviderAuthorizeUrlResult;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthExchangeResult>;
}
