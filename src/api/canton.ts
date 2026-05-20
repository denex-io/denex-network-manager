import { readFile } from 'node:fs/promises';
import { TokenManager, createAuthHeader } from './auth.ts';

export interface PartyDetails {
  party: string;
  localMetadata?: {
    resourceVersion?: string;
    annotations?: Record<string, string>;
  };
  identityProviderId?: string;
  isLocal: boolean;
}

export interface UserDetails {
  id: string;
  primaryParty?: string;
  isDeactivated: boolean;
  metadata?: {
    resourceVersion?: string;
    annotations?: Record<string, string>;
  };
  identityProviderId?: string;
}

export interface ApiUserRight {
  kind:
    | { CanActAs: { value: { party: string } } }
    | { CanReadAs: { value: { party: string } } }
    | { CanExecuteAs: { value: { party: string } } }
    | { ParticipantAdmin: { value: Record<string, never> } }
    | { CanReadAsAnyParty: { value: Record<string, never> } }
    | { CanExecuteAsAnyParty: { value: Record<string, never> } }
    | { IdentityProviderAdmin: { value: Record<string, never> } };
}

export interface PackageDetails {
  packageId: string;
  packageSize: number;
  knownSince: string;
  sourceDescription?: string;
}

export interface ConnectedSynchronizer {
  synchronizerAlias: string;
  synchronizerId: string;
  permission: string;
}

export interface CantonClientOptions {
  baseUrl: string;
  keycloakUrl?: string;
  realm?: string;
  clientId?: string;
  clientSecret?: string;
  userClientId?: string;
  userId?: string;
  password?: string;
}

export class CantonClient {
  private baseUrl: string;
  private tokenManager?: TokenManager;
  private realm?: string;
  private clientId?: string;
  private clientSecret?: string;
  private userClientId?: string;
  private userId?: string;
  private password?: string;

  constructor(options: CantonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenManager = options.keycloakUrl ? new TokenManager(options.keycloakUrl) : undefined;
    this.realm = options.realm;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.userClientId = options.userClientId;
    this.userId = options.userId;
    this.password = options.password;
  }

  /**
   * Create a CantonClient that authenticates as a specific user.
   * Useful for integration tests that verify per-user Ledger API access.
   */
  static forUser(
    baseUrl: string,
    userId: string,
    options: Omit<CantonClientOptions, 'baseUrl' | 'userId'>,
  ): CantonClient {
    return new CantonClient({ ...options, baseUrl, userId });
  }

  /**
   * Get the base URL of this client (for testing/debugging).
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.tokenManager || !this.realm) {
      throw new Error('CantonClient requires Keycloak configuration for authenticated requests');
    }

    if (this.userId) {
      if (!this.userClientId) {
        throw new Error('CantonClient requires userClientId for per-user authentication');
      }

      return this.tokenManager.getPasswordToken({
        realm: this.realm,
        clientId: this.userClientId,
        username: this.userId,
        password: this.password ?? this.userId,
      });
    }

    return this.tokenManager.getToken(this.realm, this.clientId, this.clientSecret);
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
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
      throw new CantonApiError(response.status, `${method} ${path}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return {} as T;
  }

  async getParticipantId(): Promise<string> {
    const result = await this.request<{ participantId: string }>('GET', '/v2/parties/participant-id');
    return result.participantId;
  }

  async listConnectedSynchronizers(): Promise<ConnectedSynchronizer[]> {
    const result = await this.request<{ connectedSynchronizers?: ConnectedSynchronizer[] }>(
      'GET', '/v2/state/connected-synchronizers'
    );
    return result.connectedSynchronizers ?? [];
  }

  async listParties(): Promise<PartyDetails[]> {
    const result = await this.request<{ partyDetails: PartyDetails[] }>('GET', '/v2/parties');
    return result.partyDetails ?? [];
  }

  async allocateParty(
    partyIdHint: string,
    displayName?: string,
  ): Promise<PartyDetails> {
    const body: Record<string, unknown> = {
      partyIdHint,
      localMetadata: {
        resourceVersion: '',
        annotations: displayName ? { displayName } : {},
      },
    };

    const result = await this.request<{ partyDetails: PartyDetails }>('POST', '/v2/parties', body);
    return result.partyDetails;
  }

  async listUsers(): Promise<UserDetails[]> {
    const result = await this.request<{ users: UserDetails[] }>('GET', '/v2/users');
    return result.users ?? [];
  }

  async getUser(userId: string): Promise<UserDetails> {
    const result = await this.request<{ user: UserDetails }>('GET', `/v2/users/${encodeURIComponent(userId)}`);
    return result.user;
  }

  async createUser(
    userId: string,
    primaryParty?: string,
    rights?: ApiUserRight[],
  ): Promise<UserDetails> {
    const body: Record<string, unknown> = {
      user: {
        id: userId,
        primaryParty: primaryParty ?? '',
        isDeactivated: false,
        identityProviderId: '',
        metadata: {
          resourceVersion: '',
          annotations: {},
        },
      },
      rights: rights ?? [],
    };

    const result = await this.request<{ user: UserDetails }>('POST', '/v2/users', body);
    return result.user;
  }

  async grantApiUserRights(userId: string, rights: ApiUserRight[]): Promise<ApiUserRight[]> {
    const body = {
      userId,
      identityProviderId: '',
      rights,
    };
    const result = await this.request<{ newlyGrantedRights: ApiUserRight[] }>(
      'POST',
      `/v2/users/${encodeURIComponent(userId)}/rights`,
      body,
    );
    return result.newlyGrantedRights ?? [];
  }

  async revokeApiUserRights(userId: string, rights: ApiUserRight[]): Promise<ApiUserRight[]> {
    const body = {
      userId,
      identityProviderId: '',
      rights,
    };
    const result = await this.request<{ newlyRevokedRights: ApiUserRight[] }>(
      'PATCH',
      `/v2/users/${encodeURIComponent(userId)}/rights`,
      body,
    );
    return result.newlyRevokedRights ?? [];
  }

  async listApiUserRights(userId: string): Promise<ApiUserRight[]> {
    const result = await this.request<{ rights: ApiUserRight[] }>(
      'GET',
      `/v2/users/${encodeURIComponent(userId)}/rights`,
    );
    return result.rights ?? [];
  }

  async listPackages(): Promise<PackageDetails[]> {
    const result = await this.request<{ packageDetails: PackageDetails[] }>('GET', '/v2/packages');
    return result.packageDetails ?? [];
  }

  async uploadDar(darContent: Uint8Array): Promise<string> {
    const authHeaders = await this.getAuthHeaders();
    const url = `${this.baseUrl}/v2/dars`;

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(darContent)], { type: 'application/octet-stream' });
    formData.append('dar_file', blob, 'package.dar');

    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new CantonApiError(response.status, `DAR upload failed: ${errorText}`);
    }

    const result = await response.json();
    return result.mainPackageId ?? '';
  }

  async uploadDarFromFile(filePath: string): Promise<string> {
    const darContent = await readFile(filePath);
    return this.uploadDar(darContent);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/livez`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const result = await this.request<{ version: string }>('GET', '/v2/version');
      return result.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

export class CantonApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CantonApiError';
  }
}

export function createCanActAs(party: string): ApiUserRight {
  return { kind: { CanActAs: { value: { party } } } };
}

export function createCanReadAs(party: string): ApiUserRight {
  return { kind: { CanReadAs: { value: { party } } } };
}

export function createParticipantAdmin(): ApiUserRight {
  return { kind: { ParticipantAdmin: { value: {} as Record<string, never> } } };
}

export function createCanExecuteAs(party: string): ApiUserRight {
  return { kind: { CanExecuteAs: { value: { party } } } };
}

export function createCanReadAsAnyParty(): ApiUserRight {
  return { kind: { CanReadAsAnyParty: { value: {} as Record<string, never> } } };
}

export function createCanExecuteAsAnyParty(): ApiUserRight {
  return { kind: { CanExecuteAsAnyParty: { value: {} as Record<string, never> } } };
}

export function createIdentityProviderAdmin(): ApiUserRight {
  return { kind: { IdentityProviderAdmin: { value: {} as Record<string, never> } } };
}
