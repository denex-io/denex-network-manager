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
import { parseLocalNetConfig, parseStoredLocalNetConfig } from './schemas/mod.ts';
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
import type {
  ConfigWarning,
  FullEnvironmentInfo,
  LocalNetWarning,
  ValidatorEndpoints,
} from './types/state.ts';
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
  type PartyDetails,
  type UserDetails,
} from './api/canton.ts';
import { ValidatorAdminClient, ValidatorApiError } from './api/validator.ts';
import { type HostedParties, mergeHostedParties } from './api/parties.ts';
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
import { access, readFile } from 'node:fs/promises';
import process from 'node:process';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface LocalNetOptions {
  instanceId?: string;
  labelPrefix?: string;
  images?: ContainerBuilderOptions['images'];
  dbUser?: string;
  dbPassword?: string;
  /**
   * Receives non-fatal problems, for example a validator that did not respond to a
   * query whose other results are still returned. Defaults to `console.warn`.
   * Runtime query warnings are delivered here on every occurrence and are not stored.
   * Config warnings (`source: 'config'`, with `path`, for example unknown keys) are
   * delivered once at construction or in `fromConfig` and are also kept in
   * `LocalNet.warnings`.
   */
  onWarning?: (warning: LocalNetWarning) => void;
  /**
   * Directory that relative `packages[].dar` paths resolve against when the packages are
   * uploaded (falling back to the current directory when the file is not found there).
   * Not part of the config, so it is never compared by {@link LocalNet.detectConfigMismatch}.
   * {@link LocalNet.fromConfig} sets it to the YAML file's directory when given a path;
   * `start()` stores it in the `<labelPrefix>.config-dir` label and
   * {@link LocalNet.fromInstanceId} reads it back.
   */
  configDir?: string;
}

/** A configured package with its DAR path made absolute and its upload targets filled in. */
export interface ResolvedPackage {
  name: string;
  /** Absolute DAR path. */
  dar: string;
  /** `'sv'` and/or validator names. */
  targets: string[];
}

export interface ConfigMismatch {
  hasMismatch: boolean;
  expected: { validators: string[] };
  actual: { validators: string[] };
  message: string;
}

/**
 * Configs that `fromConfig` and `fromInstanceId` already parsed, with the warnings the
 * parse produced. The constructor does not parse these again (stored configs must not be
 * re-checked against the input rules).
 */
const trustedConfigs = new WeakMap<object, readonly ConfigWarning[]>();

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the configured packages for upload without changing the config: a relative
 * `dar` becomes absolute against `configDir` (the file is then looked for in the current
 * directory if it is not there; with no `configDir`, only the current directory is used),
 * and `uploadTo` defaults to `'sv'` plus every validator. When the DAR is found in neither
 * place the `configDir` candidate is returned, so errors name the expected location.
 */
export async function resolvePackages(
  config: LocalNetConfig,
  configDir?: string,
): Promise<ResolvedPackage[]> {
  const all = ['sv', ...normalizeValidators(config.validators).map((v) => v.name)];
  const resolved: ResolvedPackage[] = [];
  for (const pkg of config.packages ?? []) {
    let dar = pkg.dar;
    if (!isAbsolute(dar)) {
      const primary = resolve(configDir ?? process.cwd(), dar);
      const fallback = resolve(dar);
      dar = !(await fileExists(primary)) && (await fileExists(fallback)) ? fallback : primary;
    }
    resolved.push({ name: pkg.name, dar, targets: pkg.uploadTo ?? all });
  }
  return resolved;
}

/** Returns one message per package whose DAR file does not exist. */
export async function findMissingPackageFiles(packages: ResolvedPackage[]): Promise<string[]> {
  const missing: string[] = [];
  for (const pkg of packages) {
    if (!(await fileExists(pkg.dar))) {
      missing.push(`Package '${pkg.name}': DAR file not found: ${pkg.dar}`);
    }
  }
  return missing;
}

/** Throws if any package's DAR file is missing. */
export async function assertPackageFilesExist(packages: ResolvedPackage[]): Promise<void> {
  const missing = await findMissingPackageFiles(packages);
  if (missing.length > 0) throw new Error(missing.join('; '));
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

/**
 * What a single `start()` call has changed in Docker, so a failure can undo
 * exactly that and nothing else. `created` maps container name to id; `started`
 * maps the name of a pre-existing container to its id and the startup layer it
 * was started in. `layer` is the index of the layer currently being started.
 */
interface StartRollback {
  networkCreated: boolean;
  volumeCreated: boolean;
  layer: number;
  created: Map<string, string>;
  started: Map<string, { id: string; layer: number }>;
  /**
   * Names of every container this call started, created or restarted. A
   * running container that depends on one of these is restarted too (it may
   * hold stale addresses), but is not added to `started`: rollback leaves it
   * running.
   */
  touched: Set<string>;
  /**
   * Running dependents this call stopped to restart, by name. They were running
   * before the call, so a rollback starts them again (best-effort).
   */
  restarted: Map<string, string>;
  /**
   * Set when a create hit a 409: another process is starting the instance, so
   * rollback must not stop containers this call merely started.
   */
  conflict: boolean;
}

/**
 * Containers in `created` state younger than this may belong to a start in another process.
 * The age is the local clock minus the daemon's `Created` timestamp, so it assumes the two
 * clocks agree to within a few seconds.
 */
const YOUNG_CREATED_SECONDS = 60;

export class LocalNet {
  private client: DockerClient;
  private networkManager: NetworkManager;
  private config: LocalNetConfig;
  private configWarnings: readonly ConfigWarning[];
  private options: Required<Omit<LocalNetOptions, 'configDir'>> & { configDir?: string };
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
  /**
   * Creates a handle for `config`. The config is validated like any input: schema
   * defaults are applied, unknown keys are reported through `onWarning`, and the input
   * rules (unique validator names, the 65535 port limit) are enforced. A config that
   * {@link LocalNet.fromConfig} or {@link LocalNet.fromInstanceId} already parsed is not
   * checked again. {@link LocalNet.getConfig} returns the normalized copy, not `config`.
   *
   * @throws {ZodError} If the config is invalid.
   */
  constructor(config: LocalNetConfig, options?: LocalNetOptions) {
    const onWarning = options?.onWarning ?? ((w: LocalNetWarning) => console.warn(w.message));
    const trusted = trustedConfigs.get(config);
    // One-shot: a later mutation of the same object must be validated again.
    trustedConfigs.delete(config);
    if (trusted) {
      this.config = config;
      this.configWarnings = trusted;
    } else {
      const warnings: ConfigWarning[] = [];
      this.config = parseLocalNetConfig(config, {
        onWarning: (w) => {
          warnings.push(w);
          onWarning(w);
        },
      });
      this.configWarnings = warnings;
    }
    const instanceId = options?.instanceId ?? DEFAULT_INSTANCE_ID;
    const labelPrefix = options?.labelPrefix ?? DEFAULT_LABEL_PREFIX;
    this.options = {
      instanceId,
      labelPrefix,
      images: options?.images ?? {},
      dbUser: options?.dbUser ?? 'cnadmin',
      dbPassword: options?.dbPassword ?? 'supersafe',
      onWarning,
      configDir: options?.configDir === undefined ? undefined : resolve(options.configDir),
    };

    this.client = new DockerClient({ labelPrefix });
    this.networkManager = new NetworkManager(this.client, { prefix: labelPrefix });

    this.initializeApiClients();
  }

  static async fromConfig(
    yamlPathOrConfig: string | LocalNetConfig,
    options?: LocalNetOptions,
  ): Promise<LocalNet> {
    const warnings: ConfigWarning[] = [];
    const report = options?.onWarning ?? ((w: LocalNetWarning) => console.warn(w.message));
    const parseOptions = {
      onWarning: (w: ConfigWarning) => {
        warnings.push(w);
        report(w);
      },
    };
    const config = typeof yamlPathOrConfig === 'string'
      ? await loadConfigFile(yamlPathOrConfig, parseOptions)
      : parseLocalNetConfig(yamlPathOrConfig, parseOptions);
    trustedConfigs.set(config, warnings);
    const configDir = options?.configDir ??
      (typeof yamlPathOrConfig === 'string' ? dirname(resolve(yamlPathOrConfig)) : undefined);
    return new LocalNet(config, { ...options, configDir });
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
      config = parseStoredLocalNetConfig(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to parse config from instance '${id}': ${msg}`,
      );
    }

    trustedConfigs.set(config, []);
    // Containers recreated by a repair may carry a newer label than the rest; use the first one.
    const configDir = options?.configDir ??
      containers.find((c) => c.labels[`${labelPrefix}.config-dir`])
        ?.labels[`${labelPrefix}.config-dir`];
    const localnet = new LocalNet(config, { ...options, instanceId: id, configDir });
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

  /**
   * Warnings about the config this handle was created from (for example unknown keys
   * that were ignored). Fixed at construction; runtime query warnings go to `onWarning`
   * and are not stored here.
   */
  get warnings(): readonly LocalNetWarning[] {
    return this.configWarnings;
  }

  getConfig(): LocalNetConfig {
    return this.config;
  }

  getOptions(): Required<Omit<LocalNetOptions, 'configDir'>> & { configDir?: string } {
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

  /**
   * Start the instance, creating or starting whatever containers, network and
   * postgres volume are missing.
   *
   * Failure is non-destructive: if `start()` fails, it removes only the
   * containers, network and volume that this call created, starts back any
   * running dependents it had stopped in order to restart them, and stops
   * again the pre-existing containers it had started (except after a 409, see
   * below, when it leaves them running). A failed first start therefore leaves
   * nothing behind, while a failed resume (for example a timeout) leaves the
   * stopped containers, the network and the postgres data volume intact. The
   * instance state returns to `'stopped'`.
   *
   * Returns without changes, marking this object running, only when every
   * container the instance should have is running. A partially running
   * instance (for example after a Docker daemon restart brought back only
   * nginx) is repaired: stopped containers are started, missing ones are
   * created, running containers that depend on a container started or created
   * by this call (nginx and the web UIs after splice) are restarted, and
   * initialization runs again unless `skipInitialization` is set.
   *
   * Two guards run before anything is changed or created:
   * - a paused container is refused (run `docker unpause <name>`);
   * - a container in `created` state for under 60 seconds means another
   *   process is probably starting the instance, and `start()` aborts.
   * A `created` container of 60 seconds or more is treated as stopped and
   * started.
   *
   * A name conflict (HTTP 409) on create can happen mid-start, after this call
   * has already changed things. It also means another process is probably
   * starting the instance: `start()` aborts, removes only the containers this
   * call created, and neither stops the containers this call started nor
   * removes the network or volume it created.
   *
   * On a fresh start with initialization enabled, a configured `packages` DAR
   * that cannot be found throws before Docker is touched (on resume or repair
   * it is only a warning).
   *
   * A handle that already counts as running (one from `fromInstanceId()`, or one
   * on which a state query such as `getParties()` has attached) throws
   * `LocalNet is already running` instead of repairing: repair needs a handle
   * that is not attached.
   */
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
    const expectedNames = this.buildContainerSpecs(EMPTY_GENERATED_CONFIGS).map((s) => s.name);
    const byName = new Map(existing.map((c) => [c.name, c]));
    const present = expectedNames.flatMap((n) => byName.get(n) ?? []);

    const paused = present.find((c) => c.state === 'paused');
    if (paused) {
      throw new Error(
        `Container '${paused.name}' is paused. Run 'docker unpause ${paused.name}' and try again.`,
      );
    }
    const nowSeconds = Date.now() / 1000;
    for (const c of present) {
      if (c.state !== 'created' || c.created === undefined) continue;
      const age = Math.max(0, Math.round(nowSeconds - c.created));
      if (age < YOUNG_CREATED_SECONDS) {
        throw new Error(
          `Instance '${this.options.instanceId}' appears to be starting in another process ` +
            `('${c.name}' created ${age}s ago); if none is, retry in a minute.`,
        );
      }
    }

    const running = present.filter((c) => c.state === 'running');
    if (running.length === expectedNames.length) {
      this.internalState = 'running';
      this.attachedToRunning = true;
      return;
    }
    if (running.length > 0) {
      options?.onProgress?.('Instance is partially running; starting stopped containers...');
      for (const c of present) this.containerIds.set(c.name, c.id);
    }

    // A missing DAR stops a fresh start before Docker is touched. On resume or repair the
    // instance is worth more than the upload, so initializeResources warns instead.
    if (present.length === 0 && !options?.skipInitialization) {
      await assertPackageFilesExist(await resolvePackages(this.config, this.options.configDir));
    }

    const timeout = options?.timeout ?? 300000;
    const startTime = Date.now();
    const rb: StartRollback = {
      networkCreated: false,
      volumeCreated: false,
      layer: 0,
      created: new Map(),
      started: new Map(),
      touched: new Set(),
      restarted: new Map(),
      conflict: false,
    };

    try {
      this.internalState = 'starting';

      const dockerAvailable = await this.client.ping();
      if (!dockerAvailable) {
        throw new Error('Docker daemon is not available');
      }

      await this.validatePortAvailability();

      const generatedConfigs = this.buildGeneratedConfigs();

      rb.networkCreated = (await this.networkManager.ensure(this.options.instanceId)).created;

      const postgresVolumeName = `${this.options.instanceId}-postgres-data`;
      if (!(await this.client.findVolume(postgresVolumeName))) {
        await this.client.createVolume(postgresVolumeName, {
          [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
        });
        rb.volumeCreated = true;
      }

      const containerSpecs = this.buildContainerSpecs(generatedConfigs);
      const layers = getStartupOrder(containerSpecs);

      for (const [layerIndex, layer] of layers.entries()) {
        rb.layer = layerIndex;
        if (Date.now() - startTime > timeout) {
          throw new Error('Startup timeout exceeded');
        }

        const parallel = options?.parallel ?? true;

        // Two phases per layer. Every sibling finishes its Docker mutations
        // (settled, not raced) before any health wait begins, so a failure
        // can be rolled back without a sibling still creating or starting
        // containers behind the rollback's back.
        if (parallel) {
          const results = await Promise.allSettled(
            layer.map((spec) => this.ensureStarted(spec, rb, options)),
          );
          const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
          if (failed) throw failed.reason;
          await Promise.all(layer.map((spec) => this.waitHealthy(spec, options)));
        } else {
          for (const spec of layer) {
            await this.ensureStarted(spec, rb, options);
            await this.waitHealthy(spec, options);
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
      // Undo only what this call did (see rollbackStart). Best-effort: a
      // cleanup failure must not mask the original startup error.
      if (
        rb.networkCreated || rb.volumeCreated || rb.created.size > 0 || rb.started.size > 0 ||
        rb.restarted.size > 0
      ) {
        options?.onProgress?.('Startup failed; removing resources created by this attempt...');
        try {
          await this.rollbackStart(rb);
        } catch {
          // Swallow — the original error below is what matters.
        }
      }
      this.internalState = 'stopped';
      this.startedAt = undefined;
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
   * Undo a failed `start()` without touching anything the call did not itself
   * change. Every step is best-effort and independent:
   * 1. start again the running dependents this call stopped to restart;
   * 2. force-remove containers this call created;
   * 3. unless a create hit a 409, stop pre-existing containers this call
   *    started, one layer at a time in reverse layer order (a layer's stops
   *    finish before the previous layer's begin);
   * 4. remove the network only if this call created it (and no 409 happened);
   * 5. remove the postgres volume only if this call created it (and no 409
   *    happened);
   * 6. forget the created containers' ids.
   * A failed resume therefore leaves existing containers, network and data
   * volume in place (stopped), while a failed fresh start leaves nothing.
   */
  private async rollbackStart(rb: StartRollback): Promise<void> {
    // Dependents that were running before this call and were stopped to restart.
    // Start them first, while their upstreams still run: nginx has static
    // proxy_pass hostnames and no resolver, and Docker DNS drops stopped
    // containers, so an nginx started after its upstreams stop crash-loops with
    // "host not found in upstream".
    await Promise.allSettled(
      [...rb.restarted.values()].map((id) => this.client.startContainer(id)),
    );

    await Promise.allSettled(
      [...rb.created.values()].map((id) => this.client.removeContainer(id, true)),
    );

    // Stop later layers first so dependents go down before their dependencies;
    // containers within one layer are independent and stop concurrently.
    const byLayer = new Map<number, string[]>();
    for (const { id, layer } of rb.started.values()) {
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), id]);
    }
    // After a 409 another process may be mid-start: leave what this call started alone.
    if (!rb.conflict) {
      for (const layer of [...byLayer.keys()].sort((a, b) => b - a)) {
        await Promise.allSettled(
          (byLayer.get(layer) ?? []).map((id) => this.client.stopContainer(id, 30)),
        );
      }
    }

    // After a 409 the other process may already build on the network and volume
    // this call created: leave them for it (or for a retry) as well.
    if (rb.networkCreated && !rb.conflict) {
      await this.networkManager.remove(this.options.instanceId).catch(() => {});
    }
    if (rb.volumeCreated && !rb.conflict) {
      await this.client.removeVolume(`${this.options.instanceId}-postgres-data`).catch(() => {});
    }

    for (const name of rb.created.keys()) {
      this.containerIds.delete(name);
    }
  }

  /**
   * Remove every Docker resource belonging to this instance: containers, the
   * network, and named volumes (all matched by the `<labelPrefix>.instance`
   * label). Best-effort — individual removals that fail (e.g. already gone) do
   * not abort the rest. Used only by `destroy()`; `start()`'s failure path uses
   * the narrower {@link rollbackStart}.
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

  /**
   * Stop then start. If the start step fails the instance is left stopped (a
   * failed start never removes pre-existing containers or data), except after a
   * name conflict (409) on create, when another process is probably starting the
   * instance and the containers this call started are left running.
   */
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
      runningConfig = parseStoredLocalNetConfig(parsed);
    } catch {
      return {
        hasMismatch: true,
        expected: { validators: normalizeValidators(this.config.validators).map((v) => v.name) },
        actual: { validators: [] },
        message: mismatchMessage,
      };
    }

    const currentConfigJson = JSON.stringify(parseStoredLocalNetConfig(this.config));
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

  /**
   * `'running'` if every container the instance should have is running,
   * `'partial'` if only some are (a missing container counts as not running),
   * `'stopped'` if none are, and `'absent'` if the instance has no containers.
   */
  async state(): Promise<'running' | 'stopped' | 'partial' | 'absent'> {
    try {
      const containers = await this.client.listContainers({
        [`${this.options.labelPrefix}.instance`]: this.options.instanceId,
      });
      const expected = this.buildContainerSpecs(EMPTY_GENERATED_CONFIGS).map((s) => s.name);
      const byName = new Map(containers.map((c) => [c.name, c]));
      if (containers.length === 0) return 'absent';
      const running = expected.filter((n) => byName.get(n)?.state === 'running').length;
      if (running === 0) return 'stopped';
      if (running === expected.length) return 'running';
      return 'partial';
    } catch {
      return 'absent';
    }
  }

  /** `true` if every container of the instance is running (see {@link LocalNet.state}). */
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

  /**
   * Each party hosted on the LocalNet, listed once under the validator whose participant
   * hosts it, or only the parties hosted on `validatorName`.
   *
   * Canton's `/v2/parties` returns the whole topology on every participant; this method
   * keeps only hosted (`isLocal`) entries. `displayName` is the host's annotation, else
   * the hint. With no name, a participant that does not respond produces a warning naming
   * it (via `onWarning`, default `console.warn`) and its parties are omitted from the
   * result; if none responds it throws. A named validator that is unknown or unreachable
   * throws. Per-validator results are cached for 30 seconds; `allocateParty` and
   * `createUser` clear the affected validator's entry. A party hosted on several
   * participants (DNM never does this) is listed under the first, in SV-then-config order.
   *
   * @param validatorName - Restrict to parties hosted on this validator (`'sv'` or a
   *   configured validator name).
   */
  async getParties(validatorName?: string): Promise<ApiPartyInfo[]> {
    await this.requireRunning('getParties');

    if (validatorName) {
      const hosted = await this.getHostedPartiesCached(validatorName);
      return hosted.parties.map((p) => this.toPartyInfo(p, validatorName, hosted.participantId));
    }

    const { parties, failures } = await this.listPartiesWithFailures();
    for (const failure of failures) {
      this.warn({
        source: 'query',
        validator: failure.validator,
        message:
          `Could not list parties on ${failure.validator}: ${failure.error}; its parties are omitted`,
      });
    }
    return parties;
  }

  /**
   * Like {@link LocalNet.getParties} with no name, but returns the per-validator failures
   * instead of passing them to `onWarning`. Used by the discovery server.
   *
   * @throws If no participant responds.
   */
  async listPartiesWithFailures(): Promise<
    { parties: ApiPartyInfo[]; failures: Array<{ validator: string; error: string }> }
  > {
    await this.requireRunning('listPartiesWithFailures');

    const names = this.hostNames();
    const settled = await Promise.allSettled(names.map((n) => this.getHostedPartiesCached(n)));
    const merged = mergeHostedParties(names, settled);
    if (merged.failures.length === names.length) {
      const detail = merged.failures.map((f) => `${f.validator}: ${f.error}`).join('; ');
      throw new Error(`Could not list parties: no participant responded (${detail})`);
    }
    return {
      parties: merged.parties.map((m) => this.toPartyInfo(m.party, m.validator, m.participantId)),
      failures: merged.failures,
    };
  }

  /** `'sv'` followed by the configured validators, in config order. */
  private hostNames(): string[] {
    return ['sv', ...normalizeValidators(this.config.validators).map((v) => v.name)];
  }

  private warn(warning: LocalNetWarning): void {
    this.options.onWarning(warning);
  }

  /** Queries the parties hosted on `name` (uncached). Errors propagate. */
  private async fetchHostedParties(name: string): Promise<HostedParties> {
    const client = this.cantonClients.get(name);
    if (!client) throw new Error(`Unknown validator: ${name}`);

    const [participantId, parties] = await Promise.all([
      client.getParticipantId(),
      client.listParties(),
    ]);
    return { participantId, parties: parties.filter((p) => p.isLocal === true) };
  }

  /** Cached {@link LocalNet.fetchHostedParties}; only successes are cached. */
  private async getHostedPartiesCached(name: string): Promise<HostedParties> {
    const cacheKey = `parties:${name}`;
    const cached = this.getCached<HostedParties>(cacheKey);
    if (cached) return cached;

    const hosted = await this.fetchHostedParties(name);
    this.setCache(cacheKey, hosted);
    return hosted;
  }

  /**
   * Allocates a party on `validatorName`'s participant.
   *
   * @param hint - Party ID hint (the part of the party ID before `::`).
   * @param validatorName - `'sv'` or a configured validator name.
   * @param displayName - Stored as the `displayName` annotation on the hosting participant
   *   and returned by `getParties`; when omitted, `getParties` reports the hint.
   */
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

    return this.toPartyInfo(party, validatorName, participantId);
  }

  /**
   * Users on one validator's participant. An unknown or unreachable validator throws.
   */
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

  /**
   * Users with their rights, for one validator or for every participant.
   *
   * With `validatorName`, an unknown or unreachable validator throws. With no name, a
   * participant that does not respond produces a warning naming it (via `onWarning`) and
   * its users are omitted; if none responds it throws. A user whose rights cannot be
   * listed is returned with `rights: []` and a warning. Per-validator results are cached
   * for 30 seconds; failures are never cached.
   */
  async getUsersWithRights(validatorName?: string): Promise<ApiUserInfoWithRights[]> {
    await this.requireRunning('getUsersWithRights');

    if (validatorName) return await this.getUsersWithRightsCached(validatorName);

    const names = this.hostNames();
    const settled = await Promise.allSettled(names.map((n) => this.getUsersWithRightsCached(n)));
    const users: ApiUserInfoWithRights[] = [];
    const failures: Array<{ validator: string; error: string }> = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        users.push(...result.value);
        return;
      }
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ validator: names[index], error });
    });
    // Total failure throws before any warning, like getParties() and getPackages().
    if (failures.length === names.length) {
      const detail = failures.map((f) => `${f.validator}: ${f.error}`).join('; ');
      throw new Error(`Could not list users: no participant responded (${detail})`);
    }
    for (const { validator, error } of failures) {
      this.warn({
        source: 'query',
        validator,
        message: `Could not list users on ${validator}: ${error}; its users are omitted`,
      });
    }
    return users;
  }

  private async getUsersWithRightsCached(name: string): Promise<ApiUserInfoWithRights[]> {
    const cacheKey = `usersWithRights:${name}`;
    const cached = this.getCached<ApiUserInfoWithRights[]>(cacheKey);
    if (cached) return cached;

    const client = this.cantonClients.get(name);
    if (!client) throw new Error(`Unknown validator: ${name}`);

    const users = await client.listUsers();
    const result: ApiUserInfoWithRights[] = [];
    let complete = true;
    for (const user of users) {
      let rights: ApiUserRight[] = [];
      try {
        rights = await client.listApiUserRights(user.id);
      } catch (err) {
        complete = false;
        this.warn({
          source: 'query',
          validator: name,
          message: `Could not list rights for ${user.id} on ${name}: ${
            err instanceof Error ? err.message : String(err)
          }; listed with no rights`,
        });
      }
      result.push({ ...this.toUserInfo(user, name), rights });
    }

    // A partial result is never cached, so the next call re-queries the failed rights.
    if (complete) this.setCache(cacheKey, result);
    return result;
  }

  /**
   * Creates (or converges) a user on `validatorName` with the requested party and rights.
   *
   * Party hints resolve against parties hosted on `validatorName` only; a hint hosted only
   * on another validator is allocated afresh here, with the same hint but this
   * participant's namespace, so it is a different party id. A failure to query the
   * validator's parties fails the call instead of re-allocating blindly.
   *
   * `userId` must be lowercase, the same rule config input follows: Keycloak lowercases
   * usernames, so a mixed-case id would never match its token's subject.
   *
   * @throws {Error} If `userId` is not lowercase.
   */
  async createUser(
    userId: string,
    validatorName: string,
    options?: {
      primaryParty?: string;
      rights?: UserRight[];
      parties?: Array<{ hint: string; rights?: PerPartyRight[] }>;
    },
  ): Promise<ApiUserInfo> {
    const lowerUserId = userId.toLowerCase();
    if (userId !== lowerUserId) {
      throw new Error(
        `User id '${userId}' must be lowercase (Keycloak lowercases usernames); ` +
          `use '${lowerUserId}'`,
      );
    }
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

    const partyMap = new Map<string, { partyId: string; ownNamespace: boolean }>();
    if (referencedHints.size > 0) {
      // Resolve against this validator's own hosted parties, uncached; a query failure
      // fails createUser instead of triggering blind re-allocation.
      const hosted = await this.fetchHostedParties(validatorName);
      const participantNamespace = hosted.participantId.split('::').pop();
      for (const party of hosted.parties) {
        const [hint, ...rest] = party.party.split('::');
        if (!referencedHints.has(hint)) continue;
        const known = partyMap.get(hint);
        const ownNamespace = rest.join('::') === participantNamespace;
        if (known === undefined || (ownNamespace && !known.ownNamespace)) {
          partyMap.set(hint, { partyId: party.party, ownNamespace });
        }
      }
      for (const hint of referencedHints) {
        if (!partyMap.has(hint)) {
          const allocated = await this.allocateParty(hint, validatorName, hint);
          partyMap.set(hint, { partyId: allocated.partyId, ownNamespace: true });
        }
      }
    }

    const primaryPartyId = options?.primaryParty
      ? partyMap.get(options.primaryParty)?.partyId
      : undefined;

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
        const partyId = partyMap.get(partyConfig.hint)?.partyId;
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
    this.invalidateCache(`usersWithRights:${validatorName}`);

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

  /**
   * Packages known to the participants, one row per package with the validators that
   * know it. Built-in Splice and Daml packages are included. Rows are sorted by
   * `packageId`; `validators` is in SV-then-config order.
   *
   * With `validatorName`, `validators` is `[validatorName]`, and an unknown or unreachable
   * validator throws. With no name, a participant that does not respond produces a
   * warning naming it (via `onWarning`) and is left out of every row; if none responds it
   * throws. Per-validator results are cached for 30 seconds; failures are never cached.
   */
  async getPackages(validatorName?: string): Promise<ApiPackageInfo[]> {
    await this.requireRunning('getPackages');

    const { packages, failures } = await this.collectPackages(validatorName);
    for (const failure of failures) {
      this.warn({
        source: 'query',
        validator: failure.validator,
        message:
          `Could not list packages on ${failure.validator}: ${failure.error}; its packages are omitted`,
      });
    }
    return packages;
  }

  /**
   * Like {@link LocalNet.getPackages} with no name, but returns the per-validator failures
   * instead of passing them to `onWarning`. Used by the discovery server.
   *
   * @throws If no participant responds.
   */
  async listPackagesWithFailures(): Promise<
    { packages: ApiPackageInfo[]; failures: Array<{ validator: string; error: string }> }
  > {
    await this.requireRunning('listPackagesWithFailures');
    return await this.collectPackages();
  }

  private async collectPackages(
    validatorName?: string,
  ): Promise<
    { packages: ApiPackageInfo[]; failures: Array<{ validator: string; error: string }> }
  > {
    const names = validatorName ? [validatorName] : this.hostNames();
    const settled = await Promise.allSettled(names.map((n) => this.getPackageIdsCached(n)));

    const validatorsByPackage = new Map<string, string[]>();
    const failures: Array<{ validator: string; error: string }> = [];
    settled.forEach((result, index) => {
      const name = names[index];
      if (result.status === 'rejected') {
        if (validatorName) throw result.reason;
        failures.push({
          validator: name,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        return;
      }
      for (const packageId of result.value) {
        const hosts = validatorsByPackage.get(packageId);
        if (hosts) hosts.push(name);
        else validatorsByPackage.set(packageId, [name]);
      }
    });
    if (failures.length === names.length) {
      const detail = failures.map((f) => `${f.validator}: ${f.error}`).join('; ');
      throw new Error(`Could not list packages: no participant responded (${detail})`);
    }

    const packages = [...validatorsByPackage.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([packageId, validators]) => ({ packageId, validators }));
    return { packages, failures };
  }

  private async getPackageIdsCached(name: string): Promise<string[]> {
    const cacheKey = `packages:${name}`;
    const cached = this.getCached<string[]>(cacheKey);
    if (cached) return cached;

    const client = this.cantonClients.get(name);
    if (!client) throw new Error(`Unknown validator: ${name}`);

    const packageIds = await client.listPackages();
    this.setCache(cacheKey, packageIds);
    return packageIds;
  }

  /**
   * Uploads a DAR file to the given validators (default: `sv` and every validator).
   * Canton validates the DAR; use {@link LocalNet.getPackages} to see the result.
   *
   * Arguments are checked before anything is uploaded: an empty `validatorNames` list
   * or an unknown validator name (`Unknown validator: <name>`) throws without sending a
   * request. If an upload fails on some validators (including Canton rejecting the DAR),
   * the rest are still attempted and one error naming the failed validators and Canton's
   * message is thrown.
   *
   * @param filePath - Path to the `.dar` file.
   * @param validatorNames - Target participants (`'sv'` or validator names).
   */
  async uploadDar(filePath: string, validatorNames?: string[]): Promise<void> {
    const targets = validatorNames ?? this.hostNames();
    if (targets.length === 0) {
      throw new Error('uploadDar: no target validators given');
    }
    for (const name of targets) {
      if (!this.cantonClients.has(name)) throw new Error(`Unknown validator: ${name}`);
    }

    const darContent = new Uint8Array(await readFile(filePath));

    await this.requireRunning('uploadDar');

    const errors = new Map<string, Error>();
    for (const name of targets) {
      const client = this.cantonClients.get(name)!;
      try {
        await client.uploadDar(darContent);
        this.invalidateCache(`packages:${name}`);
      } catch (error) {
        errors.set(name, error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.size > 0) {
      const details = [...errors.entries()].map(([n, e]) => `${n}: ${e.message}`).join('; ');
      throw new Error(`DAR upload failed for ${errors.size} validator(s): ${details}`);
    }
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

  /**
   * Best-effort snapshot of validators, parties, users and packages. `parties` and
   * `packages` are empty if no participant responds; a validator whose users cannot be
   * listed (or that is unhealthy) is omitted from `users` with a warning via `onWarning`.
   */
  async getSnapshot(): Promise<ApiLocalNetSnapshot> {
    await this.requireRunning('getSnapshot');

    const validators = await this.getAllValidatorStates();
    const parties = await this.getParties().catch(() => []);
    const packages = await this.getPackages().catch(() => []);

    const users: ApiUserInfo[] = [];
    for (const validator of validators) {
      let reason = 'unhealthy';
      if (validator.isHealthy) {
        try {
          users.push(...await this.getUsers(validator.name));
          continue;
        } catch (err) {
          reason = err instanceof Error ? err.message : String(err);
        }
      }
      this.warn({
        source: 'query',
        validator: validator.name,
        message: `Could not list users on ${validator.name}: ${reason}; its users are omitted`,
      });
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

  /**
   * Create and/or start one container, recording each mutation in `rb`
   * immediately after it succeeds so a rollback sees exactly what changed.
   */
  private async ensureStarted(
    spec: ContainerSpec,
    rb: StartRollback,
    options?: StartOptions,
  ): Promise<void> {
    const progress = options?.onProgress ?? (() => {});
    const exists = await this.client.findContainer(spec.name);
    let containerId: string;

    if (exists) {
      containerId = exists.id;
      if (exists.state !== 'running') {
        progress(`Starting ${spec.name}...`);
        // Record before the call: if the daemon starts the container but the
        // request still fails, rollback must stop it (stopping a container that
        // never started is a harmless 304).
        rb.started.set(spec.name, { id: containerId, layer: rb.layer });
        rb.touched.add(spec.name);
        // A container in restart backoff (a crash-looping nginx after a daemon
        // restart) counts as running to Docker, so a plain start is a no-op and
        // the backoff would go on. Stop it first to end the loop.
        if (exists.state === 'restarting') await this.client.stopContainer(containerId, 30);
        await this.client.startContainer(containerId);
      } else if ((spec.dependsOn ?? []).some((dep) => rb.touched.has(dep))) {
        // A dependency was just (re)started: restart this container so it does
        // not keep addresses from before. Not recorded in rb.started.
        progress(`Restarting ${spec.name}...`);
        rb.touched.add(spec.name);
        rb.restarted.set(spec.name, containerId);
        await this.client.stopContainer(containerId, 30);
        await this.client.startContainer(containerId);
        rb.restarted.delete(spec.name);
      }
    } else {
      const networkName = this.networkManager.getExpectedNetworkName(this.options.instanceId);
      const specWithNetwork = {
        ...spec,
        networks: [networkName],
      };

      await this.pullImageIfNeeded(spec.image, progress);
      progress(`Creating ${spec.name}...`);
      try {
        containerId = await this.client.createContainer(specWithNetwork);
      } catch (error) {
        if (
          error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 409
        ) {
          rb.conflict = true;
          throw new Error(
            `Instance '${this.options.instanceId}' appears to be starting in another process ` +
              `('${spec.name}' already exists); if none is, retry in a minute.`,
          );
        }
        throw error;
      }
      rb.created.set(spec.name, containerId);
      rb.touched.add(spec.name);
      await this.client.startContainer(containerId);
    }

    this.containerIds.set(spec.name, containerId);
  }

  private async waitHealthy(spec: ContainerSpec, options?: StartOptions): Promise<void> {
    if (!spec.healthCheck || options?.skipHealthChecks) return;
    const containerId = this.containerIds.get(spec.name);
    if (!containerId) return;

    const progress = options?.onProgress ?? (() => {});
    progress(`Waiting for ${spec.name} to be healthy...`);
    const healthStart = Date.now();
    await this.waitForDockerHealthy(containerId, spec.name, spec.healthCheck);
    progress(`${spec.name} healthy (took ${((Date.now() - healthStart) / 1000).toFixed(1)}s)`);
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
   * onboard wallets, and upload the configured `packages`. Called automatically
   * by start() unless skipInitialization is set. Also exposed for the
   * `dnm init` CLI command on already-running instances.
   *
   * Safe to re-run: a configured party whose hint is already hosted on its
   * validator's participant is skipped, and users converge on their configured
   * state (see {@link LocalNet.createUser}). Packages upload to their
   * `uploadTo` validators (default `sv` and every validator); relative `dar`
   * paths resolve against `configDir`, then the current directory. A missing
   * DAR or failed upload is a `'packages'` warning, not an error. Re-uploading
   * an existing DAR is expected to be a no-op (to be confirmed by live
   * validation).
   *
   * @internal Do not call directly in application code — use start() instead.
   */
  async initializeResources(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.('Initializing resources...');

    await this.waitForApisReady(onProgress);
    await this.waitForScanActive(onProgress);

    const validators = normalizeValidators(this.config.validators);

    for (const validator of validators) {
      const validatorName = validator.name;
      const parties = validator.parties ?? [];
      if (parties.length === 0) continue;

      // A failed query must not turn into blind re-allocation: let it propagate.
      let hosted: HostedParties;
      try {
        hosted = await this.fetchHostedParties(validatorName);
      } catch (error) {
        throw new Error(
          `Cannot check existing parties on '${validatorName}': ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
      const existingHints = new Set(
        hosted.parties.map((p) => p.party.split('::')[0] ?? p.party),
      );

      for (const partyConfig of parties) {
        if (existingHints.has(partyConfig.hint)) {
          onProgress?.(
            `Party '${partyConfig.hint}' already allocated on ${validatorName}; skipping`,
          );
          continue;
        }
        try {
          onProgress?.(`Allocating party '${partyConfig.hint}' on ${validatorName}...`);
          const partyInfo = await this.allocateParty(
            partyConfig.hint,
            validatorName,
            partyConfig.displayName ?? partyConfig.hint,
          );
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

    await this.uploadConfiguredPackages(onProgress);

    onProgress?.('Resource initialization complete');
  }

  /**
   * Uploads `config.packages` to their targets. A missing DAR or a failed upload is
   * reported through `onWarning` (`source: 'packages'`) and the next package is tried;
   * re-uploading a DAR Canton already has is a no-op.
   */
  private async uploadConfiguredPackages(onProgress?: (msg: string) => void): Promise<void> {
    const packages = await resolvePackages(this.config, this.options.configDir);
    for (const pkg of packages) {
      try {
        await assertPackageFilesExist([pkg]);
        onProgress?.(`Uploading package '${pkg.name}' to ${pkg.targets.join(', ')}...`);
        const packageId = await this.uploadDar(pkg.dar, pkg.targets);
        onProgress?.(`Uploaded package '${pkg.name}': ${packageId}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.warn({
          source: 'packages',
          message: `Package '${pkg.name}' upload failed: ${reason}`,
        });
      }
    }
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
        ...(this.options.configDir
          ? { [`${this.options.labelPrefix}.config-dir`]: this.options.configDir }
          : {}),
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
