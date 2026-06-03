import { createAuthHeader, TokenManager } from './auth.ts';
import type { AuthConfig } from '../types/config.ts';

export interface ValidatorUserInfo {
  party_id: string;
  user_name: string;
  featured: boolean;
}

export interface WalletUserStatus {
  party_id: string;
  user_onboarded: boolean;
  user_wallet_installed: boolean;
  has_featured_app_right: boolean;
}

export interface OnboardUserResponse {
  party_id: string;
}

export interface ValidatorAdminClientOptions {
  baseUrl: string;
  authConfig: AuthConfig;
  keycloakUrl?: string;
  realm?: string;
  clientId?: string;
  clientSecret?: string;
}

export class ValidatorAdminClient {
  private baseUrl: string;
  private tokenManager: TokenManager;
  private realm?: string;
  private clientId?: string;
  private clientSecret?: string;

  constructor(options: ValidatorAdminClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenManager = new TokenManager(options.keycloakUrl ?? '');
    this.realm = options.realm;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getToken(this.realm, this.clientId, this.clientSecret);
    return createAuthHeader(token);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const authHeaders = await this.getAuthHeaders();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      ...authHeaders,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ValidatorApiError(response.status, `${method} ${path}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return {} as T;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/validator/readyz`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getValidatorUserInfo(): Promise<ValidatorUserInfo> {
    const response = await fetch(`${this.baseUrl}/api/validator/v0/validator-user`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new ValidatorApiError(
        response.status,
        `GET /api/validator/v0/validator-user: ${errorText}`,
      );
    }
    return response.json();
  }

  async getValidatorParty(): Promise<string> {
    const info = await this.getValidatorUserInfo();
    return info.party_id;
  }

  getWalletUserStatus(): Promise<WalletUserStatus> {
    return this.request<WalletUserStatus>('GET', '/api/validator/v0/wallet/user-status');
  }

  async getDsoPartyId(): Promise<string> {
    const result = await this.request<{ dso_party_id: string }>(
      'GET',
      '/api/validator/v0/scan-proxy/dso-party-id',
    );
    return result.dso_party_id;
  }

  onboardUser(
    name: string,
    options?: { party_id?: string; createPartyIfMissing?: boolean },
  ): Promise<OnboardUserResponse> {
    const body: Record<string, unknown> = { name };
    if (options?.party_id !== undefined) {
      body.party_id = options.party_id;
    }
    if (options?.createPartyIfMissing !== undefined) {
      body.createPartyIfMissing = options.createPartyIfMissing;
    }
    return this.request<OnboardUserResponse>('POST', '/api/validator/v0/admin/users', body);
  }
}

export class ValidatorApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ValidatorApiError';
  }
}
