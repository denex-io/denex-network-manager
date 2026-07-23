import { DockerClient } from './docker/client.ts';
import { NetworkManager } from './docker/network.ts';
import {
  buildAllContainers,
  type ContainerBuilderOptions,
  type GeneratedConfigs,
  getStartupOrder,
} from './docker/containers.ts';
import type {
  ContainerInfo,
  ContainerSpec,
  LocalNetState,
  LocalNetStatus,
  StartOptions,
  StopOptions,
} from './docker/types.ts';
import {
  getKeycloakUrl,
  getLedgerApiUserClientId,
  getRealmName,
  getValidatorClientId,
  type LocalNetConfig,
  normalizeValidators,
  type PerPartyRight,
  resolveRealmName,
  type UserRight,
} from './types/config.ts';
import { parseLocalNetConfig } from './schemas/mod.ts';
import {
  BOOTSTRAP_ADMIN_USERNAME,
  generateAllRealmsJson,
  generateFullCantonConfig,
  generateFullSpliceConfig,
} from './generator/mod.ts';
import { getSvInternalPorts, getSvPorts, getValidatorPorts } from './utils/ports.ts';
import { loadConfigFile } from './utils/yaml.ts';
import { buildConfigEnvironmentInfo } from './utils/env-info.ts';
import { type CredentialInfo, getCredentials as getCredentialsList } from './utils/credentials.ts';
import type { FullEnvironmentInfo, ValidatorEndpoints } from './types/state.ts';
import {
  type ApiUserRight,
  CantonClient,
  createCanActAs,
  createCanExecuteAs,
  createCanExecuteAsAnyParty,
  createCanReadAs,
  createCanReadAsAnyParty,
  createIdentityProviderAdmin,
  createParticipantAdmin,
  type PackageDetails,
  type PartyDetails,
  type UserDetails,
} from './api/canton.ts';
import { ValidatorAdminClient, ValidatorApiError } from './api/validator.ts';
import { KeycloakAdminClient } from './api/keycloak-admin.ts';
import type {
  ApiLocalNetSnapshot,
  ApiPackageInfo,
  ApiPartyInfo,
  ApiUserInfo,
  ApiUserInfoWithRights,
  ApiValidatorState,
} from './api/state-types.ts';
import { type DiscoveredInstance, discoverInstances } from './api/discovery-utils.ts';
import { generateNginxConfigString } from './docker/nginx.ts';

export interface LocalNetOptions {
  instanceId?: string;
  labelPrefix?: string;
  images?: ContainerBuilderOptions['images'];
  dbUser?: string;
  dbPassword?: string;
}

export interface ConfigMismatch {
  hasMismatch: boolean;
  expected: { validators: string[] };
  actual: { validators: string[] };
  message: string;
}

const DEFAULT_INSTANCE_ID = 'default';
const DEFAULT_LABEL_PREFIX = 'denex.localnet';

/**
 * Placeholder configs for code paths that build container specs only to read
 * port bindings (which never depend on generated config content).
 */
const EMPTY_GENERATED_CONFIGS: GeneratedConfigs = {
  cantonConfig: '',
  spliceConfig: '',
  nginxConfig: '',
  postgresInitScript: '',
  keycloakRealms: {},
};

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class LocalNet {
  private client: DockerClient;
  private networkManager: NetworkManager;
  private config: LocalNetConfig;
  private options: Required<LocalNetOptions>;
  private internalState: LocalNetState = 'stopped';
  private startedAt?: Date;
  private containerIds: Map<string, string> = new Map();
  private cantonClients: Map<string, CantonClient> = new Map();
  private validatorClients: Map<string, ValidatorAdminClient> = new Map();
  private keycloakAdminClient: KeycloakAdminClient | null = null;
  private apiCache: Map<string, CacheEntry<unknown>> = new Map();
  private cacheTtlMs = 30_000;
  private baseHost = 'localhost';
  private attachedToRunning = false;
  constructor(config: LocalNetConfig, options?: LocalNetOptions) {
    this.config = config;
    const instanceId = options?.instanceId ?? DEFAULT_INSTANCE_ID;
    const labelPrefix = options?.labelPrefix ?? DEFAULT_LABEL_PREFIX;
    this.options = {
      instanceId,
      labelPrefix,
      images: options?.images ?? {},
      dbUser: options?.dbUser ?? 'cnadmin',
      dbPassword: options?.dbPassword ?? 'supersafe',
    };

    this.client = new DockerClient({ labelPrefix });
    this.networkManager = new NetworkManager(this.client, { prefix: labelPrefix });

    this.initializeApiClients();
  }

  static async fromConfig(
    yamlPathOrConfig: string | LocalNetConfig,
    options?: LocalNetOptions,
  ): Promise<LocalNet> {
    let config: LocalNetConfig;
    if (typeof yamlPathOrConfig === 'string') {
      config = await loadConfigFile(yamlPathOrConfig);
    } else {
      config = parseLocalNetConfig(yamlPathOrConfig);
    }
    return new LocalNet(config, options);
  }

  static async fromInstanceId(
    id: string,
    options?: LocalNetOptions,
  ): Promise<LocalNet> {
    const labelPrefix = options?.labelPrefix ?? DEFAULT_LABEL_PREFIX;
    const client = new DockerClient({ labelPrefix });
    const containers = await client.listContainers({
      [`${labelPrefix}.instance`]: id,
    });

    if (containers.length === 0) {
      throw new Error(`No running LocalNet found for instance '${id}'.`);
    }

    const first = containers[0];
    const schema = first.labels[`${labelPrefix}.schema`];
    if (schema !== '2') {
      throw new Error(
        `Instance '${id}' uses unsupported config schema '${schema ?? 'missing'}'. ` +
          `Expected schema '2'. Stop and recreate this instance with the current SDK.`,
      );
    }

    const configJson = first.labels[`${labelPrefix}.config`];
    if (!configJson) {
      throw new Error(
        `Instance '${id}' is missing the '${labelPrefix}.config' label. ` +
          `Stop and recreate this instance with the current SDK.`,
      );
    }

    let config: LocalNetConfig;
    try {
      const raw = JSON.parse(configJson);
      config = parseLocalNetConfig(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to parse config from instance '${id}': ${msg}`,
      );
    }

    const localnet = new LocalNet(config, { ...options, instanceId: id });
    localnet.markAttachedToRunning();
    for (const container of containers) {
      localnet.containerIds.set(container.name, container.id);
    }
    return localnet;
  }

  static async discover(options?: { labelPrefix?: string }): Promise<DiscoveredInstance[]> {
    const labelPrefix = options?.labelPrefix ?? DEFAULT_LABEL_PREFIX;
    const client = new DockerClient({ labelPrefix });
    const containers = await client.listContainers();
    return discoverInstances(containers);
  }

  get instanceId(): string {
    return this.options.instanceId;
  }

  get currentState(): LocalNetState {
    return this.internalState;
  }

  getConfig(): LocalNetConfig {
    return this.config;
  }

  getOptions(): Required<LocalNetOptions> {
    return { ...this.options };
  }

  getContainerId(name: string): string | undefined {
    return this.containerIds.get(name);
  }

  getCantonClient(validatorName: string): CantonClient | undefined {
    return this.cantonClients.get(validatorName);
  }

  getValidatorClient(validatorName: string): ValidatorAdminClient | undefined {
    return this.validatorClients.get(validatorName);
  }

  async start(options?: StartOptions): Promise<void> {
    if (this.internalState === 'running') {
      throw new Error('LocalNet is already running');
    }

    if (this.internalState === 'starting') {
      throw new Error('LocalNet is already starting');
    }

    const mismatch = await this.detectConfigMismatch();
    if (mismatch.hasMismatch) {
      throw new Error(
        mismatch.message ||
          `Instance '${this.options.instanceId}' is already running with a different config. ` +
            `Stop and destroy first, or use a different instanceId.`,
      );
    }

    const existing = await this.client.listContainers({
      [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
    });
    const alreadyRunning = existing.filter((c) => c.state === 'running');
    if (alreadyRunning.length > 0) {
      this.internalState = 'running';
      this.attachedToRunning = true;
      return;
    }

    const timeout = options?.timeout ?? 300000;
    const startTime = Date.now();
    let containersCreated = false;

    try {
      this.internalState = 'starting';

      const dockerAvailable = await this.client.ping();
      if (!dockerAvailable) {
        throw new Error('Docker daemon is not available');
      }

      await this.validatePortAvailability();

      const generatedConfigs = this.buildGeneratedConfigs();

      await this.networkManager.create(this.options.instanceId);
      containersCreated = true;

      const postgresVolumeName = `${this.options.instanceId}-postgres-data`;
      await this.client.createVolume(postgresVolumeName, {
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
      });

      const containerSpecs = this.buildContainerSpecs(generatedConfigs);
      const layers = getStartupOrder(containerSpecs);

      for (const layer of layers) {
        if (Date.now() - startTime > timeout) {
          throw new Error('Startup timeout exceeded');
        }

        const parallel = options?.parallel ?? true;

        if (parallel) {
          await Promise.all(layer.map((spec) => this.startContainer(spec, options)));
        } else {
          for (const spec of layer) {
            await this.startContainer(spec, options);
          }
        }
      }

      options?.onProgress?.(
        `All containers healthy (took ${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
      );

      await this.deleteBootstrapAdmin(options?.onProgress);

      this.internalState = 'running';
      this.startedAt = new Date();

      if (!options?.skipInitialization) {
        await this.initializeResources(options?.onProgress);
      }

      options?.onProgress?.(
        `LocalNet ready (total ${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
      );
    } catch (error) {
      // Roll back any partially-created resources (network, volume, containers)
      // so a failed start does not leak. Best-effort: a cleanup failure must not
      // mask the original startup error.
      if (containersCreated) {
        options?.onProgress?.('Startup failed; cleaning up partial resources...');
        try {
          await this.cleanupInstanceResources();
          this.containerIds.clear();
        } catch {
          // Swallow — the original error below is what matters.
        }
      }
      this.internalState = 'stopped';
      throw error;
    }
  }

  async stop(options?: StopOptions): Promise<void> {
    if (this.internalState === 'stopping') {
      throw new Error('LocalNet is already stopping');
    }

    const timeout = (options?.timeout ?? 30_000) / 1000;

    try {
      this.internalState = 'stopping';

      const containers = await this.client.listContainers({
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
      });

      const runningContainers = containers.filter((c) => c.state === 'running');
      await Promise.all(
        runningContainers.map((container) => this.client.stopContainer(container.id, timeout)),
      );

      this.internalState = 'stopped';
      this.attachedToRunning = false;
      this.startedAt = undefined;
    } catch (error) {
      this.internalState = 'error';
      throw error;
    }
  }

  async destroy(options?: StopOptions): Promise<void> {
    await this.stop({ timeout: 30_000, ...options });
    await this.cleanupInstanceResources();
    this.containerIds.clear();
  }

  /**
   * Remove every Docker resource belonging to this instance: containers, the
   * network, and named volumes (all matched by the `<labelPrefix>.instance`
   * label). Best-effort — individual removals that fail (e.g. already gone) do
   * not abort the rest. Shared by `destroy()` and `start()`'s failure rollback.
   */
  private async cleanupInstanceResources(): Promise<void> {
    const containers = await this.client.listContainers({
      [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
    });

    await Promise.allSettled(
      containers.map((container) => this.client.removeContainer(container.id, true)),
    );

    await this.networkManager.remove(this.options.instanceId).catch(() => {});

    const volumes = await this.client.listVolumes({
      [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
    });

    await Promise.allSettled(
      volumes.map((volume) => this.client.removeVolume(volume.name)),
    );
  }

  async restart(options?: StartOptions & StopOptions): Promise<void> {
    await this.stop();
    await this.start(options);
  }

  async status(): Promise<LocalNetStatus> {
    const containers: ContainerInfo[] = [];

    const containerList = await this.client.listContainers({
      [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
    });

    for (const c of containerList) {
      const info = await this.client.getContainerInfo(c.id);
      if (info) containers.push(info);
    }

    const network = await this.networkManager.get(this.options.instanceId);

    const derivedState = this.deriveStateFromContainers(containers);

    return {
      state: derivedState,
      containers,
      network: network ?? undefined,
      startedAt: this.startedAt,
    };
  }

  async detectConfigMismatch(): Promise<ConfigMismatch> {
    const containers = await this.client.listContainers({
      [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
    });

    if (containers.length === 0) {
      return {
        hasMismatch: false,
        expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
        actual: { validators: [] },
        message: '',
      };
    }

    const mismatchMessage =
      `Instance '${this.options.instanceId}' is already running with a different config. Stop and destroy first, or use a different instanceId.`;

    const firstContainer = containers[0];
    const configJson = firstContainer.labels[`${this.options.labelPrefix}.config`];

    if (!configJson) {
      return {
        hasMismatch: true,
        expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
        actual: { validators: [] },
        message: mismatchMessage,
      };
    }

    let runningConfig: LocalNetConfig;
    try {
      const parsed = JSON.parse(configJson);
      runningConfig = parseLocalNetConfig(parsed);
    } catch {
      return {
        hasMismatch: true,
        expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
        actual: { validators: [] },
        message: mismatchMessage,
      };
    }

    const currentConfigJson = JSON.stringify(parseLocalNetConfig(this.config));
    const runningConfigJson = JSON.stringify(runningConfig);

    if (currentConfigJson !== runningConfigJson) {
      return {
        hasMismatch: true,
        expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
        actual: { validators: normalizeValidators(runningConfig.validators).map((v) => v.name) },
        message: mismatchMessage,
      };
    }

    return {
      hasMismatch: false,
      expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
      actual: { validators: normalizeValidators(runningConfig.validators).map((v) => v.name) },
      message: '',
    };
  }

  async state(): Promise<'running' | 'stopped' | 'partial' | 'absent'> {
    try {
      const containers = await this.client.listContainers({
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
      });
      if (containers.length === 0) return 'absent';
      const running = containers.filter((c) => c.state === 'running').length;
      if (running === 0) return 'stopped';
      if (running === containers.length) return 'running';
      return 'partial';
    } catch {
      return 'absent';
    }
  }

  async isRunning(): Promise<boolean> {
    return (await this.state()) === 'running';
  }

  async getValidatorState(validatorName: string): Promise<ApiValidatorState> {
    await this.requireRunning('getValidatorState');

    const cacheKey = `validator:${validatorName}`;
    const cached = this.getCached<ApiValidatorState>(cacheKey);
    if (cached) return cached;

    const cantonClient = this.cantonClients.get(validatorName);
    const validatorClient = this.validatorClients.get(validatorName);

    if (!cantonClient || !validatorClient) {
      throw new Error(`Unknown validator: ${validatorName}`);
    }

    const isHealthy = await cantonClient.healthCheck();
    let participantId = '';
    let validatorParty: string | undefined;

    if (isHealthy) {
      try {
        participantId = await cantonClient.getParticipantId();
        validatorParty = await validatorClient.getValidatorParty();
      } catch {
        // Participant might not be fully initialized
      }
    }

    const isSv = validatorName === 'sv';
    const ports = isSv
      ? getSvPorts(this.config.basePort)
      : this.getValidatorPortsByName(validatorName);

    const state: ApiValidatorState = {
      name: validatorName,
      role: isSv ? 'sv' : 'validator',
      participantId,
      validatorParty,
      isHealthy,
      ports: {
        ledgerApi: ports.ledgerApi,
        adminApi: ports.adminApi,
        jsonApi: ports.jsonApi,
        validatorAdminApi: ports.validatorAdminApi,
      },
    };

    this.setCache(cacheKey, state);
    return state;
  }

  async getAllValidatorStates(): Promise<ApiValidatorState[]> {
    await this.requireRunning('getAllValidatorStates');
    const normalizedValidators = normalizeValidators(this.config.validators);
    const names = ['sv', ...normalizedValidators.map((v) => v.name)];

    const states = await Promise.all(names.map((name) => this.getValidatorState(name)));
    return states;
  }

  async getValidatorPartyId(validatorName: string): Promise<string> {
    await this.requireRunning('getValidatorPartyId');

    const cacheKey = `partyId:${validatorName}`;
    const cached = this.getCached<string>(cacheKey);
    if (cached) return cached;

    const maxRetries = 10;
    const retryDelay = 2000;

    for (let i = 0; i < maxRetries; i++) {
      const state = await this.getValidatorState(validatorName);
      if (state.validatorParty) {
        this.setCache(cacheKey, state.validatorParty);
        return state.validatorParty;
      }

      if (i < maxRetries - 1) {
        this.invalidateCache(`validator:${validatorName}`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error(`Could not retrieve party ID for ${validatorName} after ${maxRetries} retries`);
  }

  async getParties(validatorName?: string): Promise<ApiPartyInfo[]> {
    await this.requireRunning('getParties');

    const cacheKey = `parties:${validatorName ?? 'all'}`;
    const cached = this.getCached<ApiPartyInfo[]>(cacheKey);
    if (cached) return cached;

    const validatorNames = validatorName
      ? [validatorName]
      : ['sv', ...normalizeValidators(this.config.validators).map((v) => v.name)];

    const allParties: ApiPartyInfo[] = [];

    for (const name of validatorNames) {
      const client = this.cantonClients.get(name);
      if (!client) continue;

      try {
        const participantId = await client.getParticipantId();
        const parties = await client.listParties();

        for (const party of parties) {
          allParties.push(this.toPartyInfo(party, name, participantId));
        }
      } catch {
        // Validator might not be healthy - continue to next
      }
    }

    this.setCache(cacheKey, allParties);
    return allParties;
  }

  async allocateParty(
    hint: string,
    validatorName: string,
    displayName?: string,
  ): Promise<ApiPartyInfo> {
    await this.requireRunning('allocateParty');

    const client = this.cantonClients.get(validatorName);
    if (!client) throw new Error(`Unknown validator: ${validatorName}`);

    const party = await client.allocateParty(hint, displayName);
    const participantId = await client.getParticipantId();

    this.invalidateCache(`parties:${validatorName}`);
    this.invalidateCache('parties:all');

    return this.toPartyInfo(party, validatorName, participantId);
  }

  async getUsers(validatorName: string): Promise<ApiUserInfo[]> {
    await this.requireRunning('getUsers');

    const cacheKey = `users:${validatorName}`;
    const cached = this.getCached<ApiUserInfo[]>(cacheKey);
    if (cached) return cached;

    const client = this.cantonClients.get(validatorName);
    if (!client) throw new Error(`Unknown validator: ${validatorName}`);

    const users = await client.listUsers();
    const userInfos = users.map((u) => this.toUserInfo(u, validatorName));

    this.setCache(cacheKey, userInfos);
    return userInfos;
  }

  async getUsersWithRights(validatorName?: string): Promise<ApiUserInfoWithRights[]> {
    await this.requireRunning('getUsersWithRights');

    const cacheKey = `usersWithRights:${validatorName ?? 'all'}`;
    const cached = this.getCached<ApiUserInfoWithRights[]>(cacheKey);
    if (cached) return cached;

    const validatorNames = validatorName
      ? [validatorName]
      : ['sv', ...normalizeValidators(this.config.validators).map((v) => v.name)];

    const allUsers: ApiUserInfoWithRights[] = [];

    for (const name of validatorNames) {
      const client = this.cantonClients.get(name);
      if (!client) continue;

      try {
        const users = await client.listUsers();

        for (const user of users) {
          let rights: ApiUserRight[] = [];
          try {
            rights = await client.listApiUserRights(user.id);
          } catch {
            // If rights query fails, include user with empty rights
          }

          allUsers.push({
            ...this.toUserInfo(user, name),
            rights,
          });
        }
      } catch {
        // Skip unhealthy validators
      }
    }

    this.setCache(cacheKey, allUsers);
    return allUsers;
  }

  async createUser(
    userId: string,
    validatorName: string,
    options?: {
      primaryParty?: string;
      rights?: UserRight[];
      parties?: Array<{ hint: string; rights?: PerPartyRight[] }>;
    },
  ): Promise<ApiUserInfo> {
    await this.requireRunning('createUser');

    const client = this.cantonClients.get(validatorName);
    if (!client) throw new Error(`Unknown validator: ${validatorName}`);

    const validatorClient = this.validatorClients.get(validatorName);
    if (!validatorClient) throw new Error(`Unknown validator: ${validatorName}`);

    const referencedHints = new Set<string>();
    if (options?.primaryParty) referencedHints.add(options.primaryParty);
    if (options?.parties) {
      for (const p of options.parties) referencedHints.add(p.hint);
    }

    const partyMap = new Map<string, string>();
    if (referencedHints.size > 0) {
      const existingParties = await this.getParties(validatorName);
      for (const party of existingParties) {
        if (referencedHints.has(party.hint)) {
          partyMap.set(party.hint, party.partyId);
        }
      }
      for (const hint of referencedHints) {
        if (!partyMap.has(hint)) {
          const allocated = await this.allocateParty(hint, validatorName, hint);
          partyMap.set(hint, allocated.partyId);
        }
      }
    }

    const primaryPartyId = options?.primaryParty ? partyMap.get(options.primaryParty) : undefined;

    try {
      await client.getUser(userId);
    } catch {
      await client.createUser(userId, primaryPartyId);
    }

    const apiRights: ApiUserRight[] = [];

    if (primaryPartyId) {
      apiRights.push(createCanActAs(primaryPartyId));
    }

    if (options?.rights) {
      for (const right of options.rights) {
        switch (right) {
          case 'ParticipantAdmin':
            apiRights.push(createParticipantAdmin());
            break;
          case 'CanReadAsAnyParty':
            apiRights.push(createCanReadAsAnyParty());
            break;
          case 'CanExecuteAsAnyParty':
            apiRights.push(createCanExecuteAsAnyParty());
            break;
          case 'IdentityProviderAdmin':
            apiRights.push(createIdentityProviderAdmin());
            break;
          case 'CanActAs':
            if (primaryPartyId) apiRights.push(createCanActAs(primaryPartyId));
            break;
          case 'CanReadAs':
            if (primaryPartyId) apiRights.push(createCanReadAs(primaryPartyId));
            break;
          case 'CanExecuteAs':
            if (primaryPartyId) apiRights.push(createCanExecuteAs(primaryPartyId));
            break;
        }
      }
    }

    if (options?.parties) {
      for (const partyConfig of options.parties) {
        const partyId = partyMap.get(partyConfig.hint);
        if (!partyId) continue;

        const partyRights = partyConfig.rights ?? ['CanActAs'];
        for (const right of partyRights) {
          switch (right) {
            case 'CanActAs':
              apiRights.push(createCanActAs(partyId));
              break;
            case 'CanReadAs':
              apiRights.push(createCanReadAs(partyId));
              break;
            case 'CanExecuteAs':
              apiRights.push(createCanExecuteAs(partyId));
              break;
          }
        }
      }
    }

    // grantApiUserRights is idempotent — granting the same right twice is a no-op.
    // Duplicate hints in options.parties[] produce a union of rights, not an error.
    if (apiRights.length > 0) {
      await client.grantApiUserRights(userId, apiRights);
    }

    const realm = resolveRealmName(validatorName);
    await this.getKeycloakAdminClient().createUser(realm, {
      username: userId,
      password: userId,
    });

    if (primaryPartyId) {
      // Re-call to converge — this method is NOT atomic. Partial failures
      // (Keycloak user created but wallet onboarding failed, etc.) are intentional;
      // caller retries createUser to reach the desired end state.
      try {
        await validatorClient.onboardUser(userId, {
          party_id: primaryPartyId,
          createPartyIfMissing: false,
        });
      } catch (err) {
        if (!(err instanceof ValidatorApiError) || err.statusCode !== 409) {
          throw err;
        }
      }
    }

    this.invalidateCache(`users:${validatorName}`);
    this.invalidateCache('users:all');
    this.invalidateCache(`parties:${validatorName}`);
    this.invalidateCache('parties:all');
    this.invalidateCache(`usersWithRights:${validatorName}`);
    this.invalidateCache('usersWithRights:all');

    const latest = await client.getUser(userId);
    return this.toUserInfo(latest, validatorName);
  }

  private getKeycloakAdminClient(): KeycloakAdminClient {
    if (!this.keycloakAdminClient) {
      this.keycloakAdminClient = new KeycloakAdminClient(
        getKeycloakUrl(this.config),
        this.config.auth.keycloak.admin,
        this.config.auth.keycloak.password,
      );
    }
    return this.keycloakAdminClient;
  }

  async getPackages(validatorName?: string): Promise<ApiPackageInfo[]> {
    await this.requireRunning('getPackages');

    const cacheKey = `packages:${validatorName ?? 'all'}`;
    const cached = this.getCached<ApiPackageInfo[]>(cacheKey);
    if (cached) return cached;

    const validatorNames = validatorName
      ? [validatorName]
      : ['sv', ...normalizeValidators(this.config.validators).map((v) => v.name)];

    const allPackages: ApiPackageInfo[] = [];
    const seenPackageIds = new Set<string>();

    for (const name of validatorNames) {
      const client = this.cantonClients.get(name);
      if (!client) continue;

      try {
        const packages = await client.listPackages();

        for (const pkg of packages) {
          if (!seenPackageIds.has(pkg.packageId)) {
            seenPackageIds.add(pkg.packageId);
            allPackages.push(this.toPackageInfo(pkg, name));
          }
        }
      } catch {
        // Skip unhealthy validators
      }
    }

    this.setCache(cacheKey, allPackages);
    return allPackages;
  }

  async uploadDar(filePath: string, validatorNames?: string[]): Promise<string> {
    await this.requireRunning('uploadDar');

    const targets = validatorNames ??
      ['sv', ...normalizeValidators(this.config.validators).map((v) => v.name)];

    let mainPackageId = '';
    const errors = new Map<string, Error>();

    for (const name of targets) {
      const client = this.cantonClients.get(name);
      if (!client) continue;

      try {
        mainPackageId = await client.uploadDarFromFile(filePath);
        this.invalidateCache(`packages:${name}`);
      } catch (error) {
        errors.set(name, error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.invalidateCache('packages:all');

    if (errors.size > 0) {
      const details = [...errors.entries()].map(([n, e]) => `${n}: ${e.message}`).join('; ');
      throw new Error(`DAR upload failed for ${errors.size} validator(s): ${details}`);
    }

    return mainPackageId;
  }

  async getDsoPartyId(): Promise<string> {
    await this.requireRunning('getDsoPartyId');

    const cacheKey = 'dsoPartyId';
    const cached = this.getCached<string>(cacheKey);
    if (cached) return cached;

    const svClient = this.validatorClients.get('sv');
    if (!svClient) throw new Error('SV validator client not found');

    const dsoPartyId = await svClient.getDsoPartyId();
    this.setCache(cacheKey, dsoPartyId);
    return dsoPartyId;
  }

  async getSnapshot(): Promise<ApiLocalNetSnapshot> {
    await this.requireRunning('getSnapshot');

    const validators = await this.getAllValidatorStates();
    const parties = await this.getParties();
    const packages = await this.getPackages();

    const users: ApiUserInfo[] = [];
    for (const validator of validators) {
      if (validator.isHealthy) {
        try {
          const validatorUsers = await this.getUsers(validator.name);
          users.push(...validatorUsers);
        } catch {
          // Skip unavailable validators
        }
      }
    }

    return {
      validators,
      parties,
      users,
      packages,
      timestamp: new Date(),
    };
  }

  async getEnvironment(): Promise<FullEnvironmentInfo> {
    await this.requireRunning('getEnvironment');

    const env = buildConfigEnvironmentInfo(this.config);

    try {
      const states = await this.getAllValidatorStates();
      for (const state of states) {
        const info = env.validators[state.name];
        if (info) {
          info.participantId = state.participantId || null;
        }
      }
    } catch {
      // best-effort
    }

    try {
      const dso = await this.getDsoPartyId();
      env.network.dsoPartyId = dso;
    } catch {
      // best-effort
    }

    try {
      const parties = await this.getParties();
      env.parties = parties.map((p) => ({
        hint: p.hint,
        displayName: p.displayName,
        partyId: p.partyId,
        validator: p.validator,
      }));
    } catch {
      // best-effort
    }

    return env;
  }

  async getCredentials(): Promise<CredentialInfo[]> {
    await this.requireRunning('getCredentials');
    return getCredentialsList(this.config.validators, this.config.basePort);
  }

  async getEndpoints(): Promise<Record<string, ValidatorEndpoints>> {
    await this.requireRunning('getEndpoints');
    const env = await this.getEnvironment();
    const endpoints: Record<string, ValidatorEndpoints> = {};
    for (const [name, info] of Object.entries(env.validators)) {
      endpoints[name] = info.endpoints;
    }
    return endpoints;
  }

  async logs(
    containerName: string,
    options?: { tail?: number; follow?: boolean },
  ): Promise<ReadableStream<Uint8Array>> {
    await this.requireRunning('logs');
    const containerId = this.containerIds.get(containerName);
    if (!containerId) {
      throw new Error(`Container ${containerName} not found`);
    }
    return this.client.getContainerLogs(containerId, options);
  }

  async exec(containerName: string, cmd: string[]): Promise<{ exitCode: number; output: string }> {
    await this.requireRunning('exec');
    const containerId = this.containerIds.get(containerName);
    if (!containerId) {
      throw new Error(`Container ${containerName} not found`);
    }
    return this.client.execInContainer(containerId, cmd);
  }

  private markAttachedToRunning(): void {
    this.attachedToRunning = true;
    this.internalState = 'running';
  }

  private async requireRunning(methodName: string): Promise<void> {
    if (this.internalState === 'running' || this.attachedToRunning) {
      return;
    }

    try {
      const containers = await this.client.listContainers({
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
      });
      const running = containers.filter((c) => c.state === 'running');
      if (running.length > 0) {
        this.markAttachedToRunning();
        return;
      }
    } catch {
      void 0;
    }

    throw new Error(
      `Cannot call '${methodName}' — instance '${this.options.instanceId}' is not running. Call .start() first.`,
    );
  }

  private initializeApiClients(): void {
    const normalizedValidators = normalizeValidators(this.config.validators);
    const svPorts = getSvPorts(this.config.basePort);
    const keycloakUrl = getKeycloakUrl(this.config);

    this.cantonClients.set(
      'sv',
      new CantonClient({
        baseUrl: `http://${this.baseHost}:${svPorts.jsonApi}`,
        keycloakUrl,
        realm: 'SV',
        clientId: getValidatorClientId('sv'),
        userClientId: getLedgerApiUserClientId('sv'),
      }),
    );

    this.validatorClients.set(
      'sv',
      new ValidatorAdminClient({
        baseUrl: `http://${this.baseHost}:${svPorts.validatorAdminApi}`,
        authConfig: this.config.auth,
        keycloakUrl,
        realm: 'SV',
        clientId: 'sv-validator',
      }),
    );

    for (let i = 0; i < normalizedValidators.length; i++) {
      const validator = normalizedValidators[i];
      const ports = getValidatorPorts(i, this.config.basePort);
      const realmName = getRealmName(validator.name);

      this.cantonClients.set(
        validator.name,
        new CantonClient({
          baseUrl: `http://${this.baseHost}:${ports.jsonApi}`,
          keycloakUrl,
          realm: realmName,
          clientId: getValidatorClientId(validator.name),
          userClientId: getLedgerApiUserClientId(validator.name),
        }),
      );

      this.validatorClients.set(
        validator.name,
        new ValidatorAdminClient({
          baseUrl: `http://${this.baseHost}:${ports.validatorAdminApi}`,
          authConfig: this.config.auth,
          keycloakUrl,
          realm: realmName,
          clientId: getValidatorClientId(validator.name),
        }),
      );
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.apiCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.apiCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.apiCache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private invalidateCache(key?: string): void {
    if (key) {
      this.apiCache.delete(key);
    } else {
      this.apiCache.clear();
    }
  }

  private toPartyInfo(party: PartyDetails, validator: string, participantId: string): ApiPartyInfo {
    const partyId = party.party;
    const parts = partyId.split('::');
    const hint = parts[0] ?? partyId;

    return {
      partyId,
      hint,
      displayName: party.localMetadata?.annotations?.displayName ?? hint,
      validator,
      participantId,
      isLocal: party.isLocal,
    };
  }

  private toUserInfo(user: UserDetails, validator: string): ApiUserInfo {
    return {
      id: user.id,
      primaryParty: user.primaryParty,
      validator,
      isDeactivated: user.isDeactivated,
    };
  }

  private toPackageInfo(pkg: PackageDetails, validator: string): ApiPackageInfo {
    return {
      packageId: pkg.packageId,
      packageSize: pkg.packageSize,
      knownSince: pkg.knownSince,
      validator,
    };
  }

  private getValidatorPortsByName(name: string): ReturnType<typeof getValidatorPorts> {
    const normalizedValidators = normalizeValidators(this.config.validators);
    const index = normalizedValidators.findIndex((v) => v.name === name);
    if (index < 0) throw new Error(`Unknown validator: ${name}`);
    return getValidatorPorts(index, this.config.basePort);
  }

  private async deleteBootstrapAdmin(onProgress?: (msg: string) => void): Promise<void> {
    try {
      const adminClient = this.getKeycloakAdminClient();
      const existing = await adminClient.findUser('master', BOOTSTRAP_ADMIN_USERNAME);
      if (!existing) {
        onProgress?.('Bootstrap admin already absent; nothing to delete');
        return;
      }

      const token = await adminClient.getToken();
      const url = `${getKeycloakUrl(this.config)}/admin/realms/master/users/${
        encodeURIComponent(existing.id)
      }`;
      const resp = await globalThis.fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok && resp.status !== 404) {
        const body = await resp.text();
        throw new Error(
          `Failed to delete bootstrap admin: HTTP ${resp.status} ${resp.statusText} — ${body}`,
        );
      }

      onProgress?.('Deleted temporary Keycloak bootstrap admin');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress?.(`Warning: bootstrap admin cleanup error (${msg}); skipping`);
    }
  }

  private async startContainer(spec: ContainerSpec, options?: StartOptions): Promise<void> {
    const progress = options?.onProgress ?? (() => {});
    const exists = await this.client.getContainerInfo(spec.name);
    let containerId: string;

    if (exists) {
      containerId = exists.id;
      if (exists.state !== 'running') {
        progress(`Starting ${spec.name}...`);
        await this.client.startContainer(containerId);
      }
    } else {
      const networkName = this.networkManager.getExpectedNetworkName(this.options.instanceId);
      const specWithNetwork = {
        ...spec,
        networks: [networkName],
      };

      await this.pullImageIfNeeded(spec.image, progress);
      progress(`Creating ${spec.name}...`);
      containerId = await this.client.createContainer(specWithNetwork);
      await this.client.startContainer(containerId);
    }

    this.containerIds.set(spec.name, containerId);

    if (spec.healthCheck && !options?.skipHealthChecks) {
      progress(`Waiting for ${spec.name} to be healthy...`);
      const healthStart = Date.now();
      await this.waitForDockerHealthy(containerId, spec.name, spec.healthCheck);
      progress(`${spec.name} healthy (took ${((Date.now() - healthStart) / 1000).toFixed(1)}s)`);
    }
  }

  private async waitForDockerHealthy(
    containerId: string,
    containerName: string,
    healthConfig?: { retries?: number; interval?: number; startPeriod?: number },
  ): Promise<void> {
    const configRetries = healthConfig?.retries ?? 30;
    const configInterval = healthConfig?.interval ?? 10;
    const startPeriod = healthConfig?.startPeriod ?? 30;

    const maxRetries = Math.max(configRetries * 2, 60);
    const retryDelay = Math.max(configInterval * 1000, 2000);
    const minRetriesBeforeUnhealthyFail = Math.ceil(startPeriod / (retryDelay / 1000));

    for (let i = 0; i < maxRetries; i++) {
      const info = await this.client.getContainerInfo(containerId);
      if (info?.health === 'healthy') {
        return;
      }
      if (info?.health === 'unhealthy' && i >= minRetriesBeforeUnhealthyFail) {
        throw new Error(`Container ${containerName} is unhealthy`);
      }
      if (info?.state !== 'running') {
        throw new Error(`Container ${containerName} stopped unexpectedly (state: ${info?.state})`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    throw new Error(`Container ${containerName} did not become healthy in time`);
  }

  private async pullImageIfNeeded(image: string, progress?: (msg: string) => void): Promise<void> {
    const exists = await this.client.imageExists(image);
    if (!exists) {
      progress?.(`Pulling ${image}...`);
      await this.client.pullImage(image);
    }
  }

  private async waitForApisReady(onProgress?: (msg: string) => void): Promise<void> {
    const validators = normalizeValidators(this.config.validators);
    const validatorNames = ['sv', ...validators.map((v) => v.name)];

    const maxRetries = 30;
    const initialDelay = 1000;
    const maxDelay = 10000;

    for (const name of validatorNames) {
      let delay = initialDelay;
      let lastError: Error | null = null;

      for (let i = 0; i < maxRetries; i++) {
        try {
          onProgress?.(`Checking API readiness for ${name}...`);
          const state = await this.getValidatorState(name);
          if (state.isHealthy && state.validatorParty) {
            onProgress?.(`${name} API is ready`);
            break;
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        if (i === maxRetries - 1) {
          throw new Error(
            `API for ${name} did not become ready: ${lastError?.message ?? 'unknown error'}`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        this.invalidateCache(`validator:${name}`);
        delay = Math.min(delay * 1.5, maxDelay);
      }
    }

    onProgress?.('All APIs are ready');
  }

  private async waitForScanActive(onProgress?: (msg: string) => void): Promise<void> {
    interface ScanStatusResponse {
      success?: {
        active?: boolean;
      };
    }

    const maxRetries = 30;
    const initialDelay = 1000;
    const maxDelay = 10000;
    let delay = initialDelay;
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        onProgress?.('Checking Scan readiness...');
        const scanPort = getSvInternalPorts(this.config.basePort).scanAdmin;
        const response = await fetch(
          `http://localhost:${scanPort}/api/scan/status`,
        );
        if (!response.ok) {
          throw new Error(`Scan status returned ${response.status}`);
        }

        const status = await response.json() as ScanStatusResponse;
        if (status.success?.active === true) {
          onProgress?.('Scan is ready');
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (i === maxRetries - 1) {
        throw new Error(`Scan did not become ready: ${lastError?.message ?? 'inactive'}`);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }
  }

  /**
   * Run post-startup initialization: allocate configured parties, create users,
   * and onboard wallets. Called automatically by start() unless skipInitialization
   * is set. Also exposed for the `dnm init` CLI command on already-running instances.
   *
   * @internal Do not call directly in application code — use start() instead.
   * Calling this on an already-initialized instance will create duplicate users.
   */
  async initializeResources(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Initializing resources...');

    await this.waitForApisReady(onProgress);
    await this.waitForScanActive(onProgress);

    const validators = normalizeValidators(this.config.validators);

    const partyMap = new Map<string, string>();

    for (const validator of validators) {
      const validatorName = validator.name;
      const parties = validator.parties ?? [];

      for (const partyConfig of parties) {
        try {
          onProgress?.(`Allocating party '${partyConfig.hint}' on ${validatorName}...`);
          const partyInfo = await this.allocateParty(
            partyConfig.hint,
            validatorName,
            partyConfig.displayName ?? partyConfig.hint,
          );
          partyMap.set(partyConfig.hint, partyInfo.partyId);
          onProgress?.(
            `Allocated party '${partyConfig.hint}': ${partyInfo.partyId.substring(0, 30)}...`,
          );
        } catch (error) {
          onProgress?.(
            `Warning: Failed to allocate party '${partyConfig.hint}': ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      }
    }

    for (const validator of validators) {
      const validatorName = validator.name;
      try {
        onProgress?.(`Initializing ${validatorName}...`);

        // NOTE: Each createUser call also onboards the user's wallet — previous
        // initializeResources never onboarded user wallets, so config-defined users
        // could not log in to the wallet UI. Latent bug fixed in T7.
        const users = validator.users ?? [];
        for (const userConfig of users) {
          try {
            await this.createUser(userConfig.id, validatorName, {
              primaryParty: userConfig.primaryParty,
              rights: userConfig.rights,
              parties: userConfig.parties,
            });
            onProgress?.(`Created user ${userConfig.id} on ${validatorName}`);
          } catch (error) {
            onProgress?.(
              `Warning: Failed to create user ${userConfig.id}: ${
                error instanceof Error ? error.message : error
              }`,
            );
          }
        }
      } catch (error) {
        onProgress?.(
          `Warning: Failed to initialize ${validatorName}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    onProgress?.('Resource initialization complete');
  }

  private deriveStateFromContainers(containers: ContainerInfo[]): LocalNetState {
    if (containers.length === 0) return 'stopped';

    const allRunning = containers.every((c) => c.state === 'running');
    const anyFailed = containers.some((c) => c.state === 'exited' || c.state === 'dead');

    if (anyFailed) return 'error';
    if (allRunning) return 'running';
    if (containers.some((c) => c.state === 'running')) return 'starting';
    return 'stopped';
  }

  private async validatePortAvailability(): Promise<void> {
    // Port bindings do not depend on generated config content, so empty
    // placeholders are sufficient for computing the set of host ports.
    const specs = this.buildContainerSpecs(EMPTY_GENERATED_CONFIGS);
    const wantedPorts = new Set<number>();
    for (const spec of specs) {
      for (const port of spec.ports ?? []) {
        if (port.host !== undefined && port.host > 0) {
          wantedPorts.add(port.host);
        }
      }
    }

    if (wantedPorts.size === 0) return;

    const allContainers = await this.client.listContainers();

    const otherContainers = allContainers.filter(
      (c) => !c.name.startsWith(`${this.options.instanceId}-`),
    );

    const usedPorts = new Map<number, string>();
    for (const container of otherContainers) {
      for (const port of container.ports) {
        if (port.host && port.host > 0) {
          usedPorts.set(port.host, container.name);
        }
      }
    }

    for (const port of wantedPorts) {
      if (usedPorts.has(port)) {
        const conflictContainer = usedPorts.get(port)!;
        throw new Error(
          `Port ${port} is already in use by container '${conflictContainer}'. ` +
            `Use a different basePort to avoid conflicts.`,
        );
      }
    }
  }

  private buildContainerSpecs(generatedConfigs: GeneratedConfigs): ContainerSpec[] {
    const builderOptions: ContainerBuilderOptions = {
      networkName: this.networkManager.getExpectedNetworkName(this.options.instanceId),
      labelPrefix: this.options.labelPrefix,
      instanceId: this.options.instanceId,
      images: this.options.images,
      dbUser: this.options.dbUser,
      dbPassword: this.options.dbPassword,
      generatedConfigs,
    };

    const specs = buildAllContainers(this.config, builderOptions);

    const prefix = this.options.instanceId;
    const nameMap = new Map<string, string>();
    for (const spec of specs) {
      const prefixedName = `${prefix}-${spec.name}`;
      nameMap.set(spec.name, prefixedName);
      spec.name = prefixedName;
    }
    for (const spec of specs) {
      if (spec.dependsOn) {
        spec.dependsOn = spec.dependsOn.map((dep) => nameMap.get(dep) ?? dep);
      }
    }

    const configJson = JSON.stringify(this.config);
    if (configJson.length > 100_000) {
      throw new Error(
        `Config too large to embed in Docker labels (${configJson.length} bytes). Maximum is 100,000 bytes.`,
      );
    }

    for (const spec of specs) {
      spec.labels = {
        ...spec.labels,
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
        [`${this.options.labelPrefix}.config`]: configJson,
        [`${this.options.labelPrefix}.schema`]: '2',
      };
    }

    return specs;
  }

  /**
   * Produce all container configuration in memory. Configs are delivered to
   * containers via environment variables (see the container builders), so
   * nothing is written to the host filesystem — the SDK leaves no `.localnet`
   * directory behind and works over a remote Docker socket.
   */
  private buildGeneratedConfigs(): GeneratedConfigs {
    return {
      cantonConfig: generateFullCantonConfig(this.config),
      spliceConfig: generateFullSpliceConfig(this.config),
      nginxConfig: generateNginxConfigString(this.config),
      postgresInitScript: buildPostgresInitScript(),
      keycloakRealms: Object.fromEntries(generateAllRealmsJson(this.config)),
    };
  }
}

/**
 * Postgres init script that creates each database named by a CREATE_DATABASE_*
 * environment variable. Written into the container's init dir at startup.
 */
function buildPostgresInitScript(): string {
  return `#!/bin/bash
set -e

for var in $(compgen -e | grep '^CREATE_DATABASE_'); do
    db_name="\${!var}"
    echo "Creating database: $db_name"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        SELECT 'CREATE DATABASE "$db_name"'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db_name')\\gexec
EOSQL
done
`;
}

export async function createLocalNet(
  config: LocalNetConfig,
  options?: LocalNetOptions,
): Promise<LocalNet> {
  const localnet = new LocalNet(config, options);
  await localnet.start();
  return localnet;
}
