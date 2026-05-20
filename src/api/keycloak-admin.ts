/**
 * Minimal Keycloak admin API client. Public surface is intentionally locked to
 * {`getToken`, `findUser`, `createUser`}. Cross-runtime: uses only `globalThis.fetch`.
 *
 * `getToken` is public because `LocalNet.deleteBootstrapAdmin` reuses the cached
 * bearer for a one-off DELETE rather than expanding this client's surface.
 */

interface CachedToken {
  accessToken: string;
  refreshAt: number;
}

export class KeycloakAdminClient {
  private readonly keycloakUrl: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  private cachedToken: CachedToken | null = null;
  private inFlightTokenFetch: Promise<string> | null = null;

  constructor(keycloakUrl: string, adminUsername: string, adminPassword: string) {
    this.keycloakUrl = keycloakUrl.replace(/\/+$/, '');
    this.adminUsername = adminUsername;
    this.adminPassword = adminPassword;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.refreshAt) {
      return this.cachedToken.accessToken;
    }

    // Concurrency dedup: callers racing into getToken share one underlying fetch.
    if (this.inFlightTokenFetch) {
      return this.inFlightTokenFetch;
    }

    const fetchPromise = this.fetchToken();
    this.inFlightTokenFetch = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      this.inFlightTokenFetch = null;
    }
  }

  async findUser(realm: string, username: string): Promise<{ id: string } | null> {
    const url = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`;
    const resp = await this.authedRequest('GET', url);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Keycloak findUser failed: HTTP ${resp.status} ${resp.statusText} — ${body}`);
    }

    const users = await resp.json();
    if (!Array.isArray(users) || users.length === 0) {
      return null;
    }

    const id = users[0]?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`Keycloak findUser: response missing 'id' on first hit`);
    }

    return { id };
  }

  async createUser(
    realm: string,
    opts: { username: string; password: string },
  ): Promise<{ id: string }> {
    const existing = await this.findUser(realm, opts.username);
    if (existing) {
      return existing;
    }

    const url = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(realm)}/users`;
    const body = {
      username: opts.username,
      enabled: true,
      // The realm-level "Verify Profile" required action otherwise rejects password
      // grants on accounts missing firstName/lastName/email/emailVerified, with
      // "Account is not fully set up" — even when `requiredActions: []`. Mirror the
      // shape produced by the realm-import users in src/generator/keycloak.ts:331-336
      // so runtime-created users behave identically to startup-defined users.
      firstName: opts.username,
      lastName: 'User',
      email: `${opts.username}@${opts.username}.localhost`,
      emailVerified: true,
      // Keycloak issue #36108: without `requiredActions: []`, Keycloak adds default
      // VERIFY_EMAIL / UPDATE_PASSWORD actions that block the password grant with
      // "Account is not fully set up." Realm-import users set this same field
      // (see src/generator/keycloak.ts:542).
      requiredActions: [],
      credentials: [
        {
          type: 'password',
          value: opts.password,
          temporary: false,
        },
      ],
    };

    const resp = await this.authedRequest('POST', url, body);

    if (!resp.ok) {
      // 409 = race with another concurrent createUser; re-resolve and return.
      if (resp.status === 409) {
        const raced = await this.findUser(realm, opts.username);
        if (raced) {
          return raced;
        }
      }
      const errBody = await resp.text();
      throw new Error(`Keycloak createUser failed: HTTP ${resp.status} ${resp.statusText} — ${errBody}`);
    }

    const location = resp.headers.get('location') ?? resp.headers.get('Location');
    if (location) {
      const idFromLocation = location.split('/').pop();
      if (idFromLocation && idFromLocation.length > 0) {
        return { id: idFromLocation };
      }
    }

    const created = await this.findUser(realm, opts.username);
    if (!created) {
      throw new Error(
        `Keycloak createUser: created user '${opts.username}' but could not resolve its ID`,
      );
    }
    return created;
  }

  private async authedRequest(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<Response> {
    const sendOnce = async (token: string): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      let serializedBody: string | undefined;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        serializedBody = JSON.stringify(body);
      }
      return globalThis.fetch(url, { method, headers, body: serializedBody });
    };

    let token = await this.getToken();
    let resp = await sendOnce(token);

    // Reactive refresh: cached token may be revoked/expired despite refreshAt.
    if (resp.status === 401) {
      this.cachedToken = null;
      token = await this.getToken();
      resp = await sendOnce(token);
    }

    return resp;
  }

  private async fetchToken(): Promise<string> {
    const tokenUrl = `${this.keycloakUrl}/realms/master/protocol/openid-connect/token`;
    const resp = await globalThis.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: this.adminUsername,
        password: this.adminPassword,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(
        `Keycloak admin token grant failed: HTTP ${resp.status} ${resp.statusText} — ${errBody}`,
      );
    }

    const data = await resp.json();
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error(`Keycloak admin token grant: response missing 'access_token'`);
    }

    const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in
      : 300;
    // Refresh at 80% of lifetime to avoid using tokens that expire mid-request.
    const refreshAt = Date.now() + Math.floor(expiresInSec * 1000 * 0.8);

    this.cachedToken = { accessToken, refreshAt };
    return accessToken;
  }
}
