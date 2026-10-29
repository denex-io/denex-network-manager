import { readFile } from 'node:fs/promises';
import { createAuthHeader, TokenManager } from './auth.ts';

const MAX_PARTY_PAGES = 1000;

export interface PartyDetails {
  party: string;
  localMetadata?: {
    resourceVersion?: string;
    annotations?: Record<string, string>;
  };
  identityProviderId?: string;
  /**
   * True when this participant hosts the party. Optional on the wire: absent means the
   * party is not hosted here (or belongs to another identity provider).
   */
  isLocal?: boolean;
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

  private getAccessToken(): Promise<string> {
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
    const result = await this.request<{ participantId: string }>(
      'GET',
      '/v2/parties/participant-id',
    );
    return result.participantId;
  }

  async listConnectedSynchronizers(): Promise<ConnectedSynchronizer[]> {
    const result = await this.request<{ connectedSynchronizers?: ConnectedSynchronizer[] }>(
      'GET',
      '/v2/state/connected-synchronizers',
    );
    return result.connectedSynchronizers ?? [];
  }

  /**
   * Lists every party in this participant's topology view, following pagination.
   *
   * `GET /v2/parties` returns the whole topology on every participant, not only the
   * parties it hosts. Filter on `isLocal` for hosted parties.
   *
   * @throws If the server returns a repeated page token or more than 1000 pages.
   */
  async listParties(): Promise<PartyDetails[]> {
    const parties: PartyDetails[] = [];
    const seenTokens = new Set<string>();
    let path = '/v2/parties';
    for (let page = 0; page < MAX_PARTY_PAGES; page++) {
      const result = await this.request<{ partyDetails?: PartyDetails[]; nextPageToken?: string }>(
        'GET',
        path,
      );
      parties.push(...(result.partyDetails ?? []));
      const token = result.nextPageToken;
      if (!token) return parties;
      if (seenTokens.has(token)) break;
      seenTokens.add(token);
      path = `/v2/parties?pageToken=${encodeURIComponent(token)}`;
    }
    throw new Error('listParties: pagination did not terminate');
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
    const result = await this.request<{ user: UserDetails }>(
      'GET',
      `/v2/users/${encodeURIComponent(userId)}`,
    );
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

  /** Lists the IDs of all packages known to this participant, built-ins included. */
  async listPackages(): Promise<string[]> {
    const result = await this.request<{ packageIds?: string[] }>('GET', '/v2/packages');
    return result.packageIds ?? [];
  }

  /**
   * Uploads a DAR as a raw `application/octet-stream` body.
   *
   * Canton answers with an empty body and validates the DAR itself.
   *
   * @throws {CantonApiError} `DAR upload failed: ...` carrying Canton's error when it
   *   rejects the DAR.
   */
  async uploadDar(darContent: Uint8Array): Promise<void> {
    const authHeaders = await this.getAuthHeaders();
    const response = await fetch(`${this.baseUrl}/v2/dars`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json',
      },
      body: new Uint8Array(darContent),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new CantonApiError(response.status, `DAR upload failed: ${errorText}`);
    }
    await response.arrayBuffer();
  }

  async uploadDarFromFile(filePath: string): Promise<void> {
    const darContent = await readFile(filePath);
    await this.uploadDar(darContent);
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
