export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
}

interface TokenCacheEntry {
  token: TokenInfo;
  fetchedAt: number;
}

interface ClientCredentialsTokenOptions {
  realm?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

interface PasswordTokenOptions {
  realm?: string;
  clientId: string;
  username: string;
  password: string;
  clientSecret?: string;
  scope?: string;
}

const REFRESH_BUFFER_MS = 30_000;

export class TokenManager {
  private cache: Map<string, TokenCacheEntry> = new Map();
  private keycloakUrl: string;

  constructor(keycloakUrl: string) {
    this.keycloakUrl = keycloakUrl;
  }

  async getToken(realm?: string, clientId?: string, clientSecret?: string): Promise<string> {
    const cacheKey = this.getCacheKey({
      grantType: 'client_credentials',
      realm,
      clientId,
    });
    const cached = this.cache.get(cacheKey);

    if (cached && !this.isExpiringSoon(cached.token)) {
      return cached.token.accessToken;
    }

    const token = await this.fetchToken({ realm, clientId, clientSecret });
    this.cache.set(cacheKey, { token, fetchedAt: Date.now() });

    return token.accessToken;
  }

  async getPasswordToken(options: PasswordTokenOptions): Promise<string> {
    const cacheKey = this.getCacheKey({
      grantType: 'password',
      realm: options.realm,
      clientId: options.clientId,
      username: options.username,
    });
    const cached = this.cache.get(cacheKey);

    if (cached && !this.isExpiringSoon(cached.token)) {
      return cached.token.accessToken;
    }

    const token = await this.fetchPasswordToken(options);
    this.cache.set(cacheKey, { token, fetchedAt: Date.now() });

    return token.accessToken;
  }

  private getCacheKey(options: {
    grantType: 'client_credentials' | 'password';
    realm?: string;
    clientId?: string;
    username?: string;
  }): string {
    return [
      options.grantType,
      options.realm ?? 'default',
      options.clientId ?? 'default',
      options.username ?? 'default',
    ].join(':');
  }

  private isExpiringSoon(token: TokenInfo): boolean {
    return Date.now() >= token.expiresAt - REFRESH_BUFFER_MS;
  }

  private fetchToken(
    options: ClientCredentialsTokenOptions,
  ): Promise<TokenInfo> {
    return this.fetchClientCredentialsToken(options);
  }

  private async fetchClientCredentialsToken(
    options: ClientCredentialsTokenOptions,
  ): Promise<TokenInfo> {
    const keycloakUrl = this.keycloakUrl;
    const actualRealm = options.realm ?? 'SV';
    const actualClientId = options.clientId ?? 'sv-validator';
    const actualClientSecret = options.clientSecret ?? `${actualClientId}-secret`;

    const tokenUrl = `${keycloakUrl}/realms/${actualRealm}/protocol/openid-connect/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: actualClientId,
        client_secret: actualClientSecret,
        ...(options.scope ? { scope: options.scope } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth2 token request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const expiresIn = data.expires_in ?? 300;

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: data.token_type ?? 'Bearer',
    };
  }

  private async fetchPasswordToken(
    options: PasswordTokenOptions,
  ): Promise<TokenInfo> {
    const keycloakUrl = this.keycloakUrl;
    const actualRealm = options.realm ?? 'SV';
    const tokenUrl = `${keycloakUrl}/realms/${actualRealm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: options.clientId,
      username: options.username,
      password: options.password,
      ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth2 token request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const expiresIn = data.expires_in ?? 300;

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: data.token_type ?? 'Bearer',
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidateToken(realm?: string, clientId?: string): void {
    const cacheKey = this.getCacheKey({
      grantType: 'client_credentials',
      realm,
      clientId,
    });
    this.cache.delete(cacheKey);
  }
}

export function createAuthHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  };
}
