/**
 * Errors denex-network-manager raises on purpose. Every one extends {@link LocalNetError}, so
 * `err instanceof LocalNetError` tells them apart from Docker, network and programming errors.
 * Config validation errors are `ZodError`s and are not part of this hierarchy.
 */

/** Base class for the errors this package raises on purpose. */
export class LocalNetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    // Not `new.target.name`: dnt 0.42 treats the `new.target` meta-property like `import.meta`,
    // adds its import.meta ponyfill to the npm build, and that ponyfill fails the build's type
    // check against @types/node 26. The value is the same here.
    this.name = this.constructor.name;
  }
}

/** One way an existing container differs from what this handle would create. */
export interface InstanceDifference {
  /** Container name, e.g. `default-splice`; `'*'` when it concerns the whole instance. */
  container: string;
  /** What differs. */
  field: 'config' | 'image';
  expected: string;
  actual: string;
}

/**
 * The instance's existing containers do not match this handle: their stored config differs, or a
 * repair would create containers next to ones running another image.
 * {@link LocalNet.start} throws it before changing anything. Destroy the instance and start it
 * again, or start it with the config and options it was created with.
 */
export class InstanceMismatchError extends LocalNetError {
  constructor(
    readonly instanceId: string,
    readonly differences: readonly InstanceDifference[],
    message: string,
  ) {
    super(message);
  }
}

/**
 * `LocalNetOptions.images` puts canton or splice-app on a Splice release whose config shape
 * differs from the release the config resolves to (`spliceVersion`, or the default). The generated
 * config would not load, so the constructor throws instead. Set `spliceVersion` to the image's
 * release.
 */
export class SpliceVersionConflictError extends LocalNetError {
  constructor(
    readonly spliceVersion: string,
    readonly image: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `start()` ran out of its timeout (`StartOptions.timeout`, the CLI's `--timeout`): while pulling an
 * image (`pull`), before starting the next layer of containers (`start`), or while waiting for the
 * validator APIs or Scan during initialization (`init`). The timeout covers the whole start, pulls
 * included. A health wait that runs out throws {@link ContainerStartupError} instead.
 */
export class StartupTimeoutError extends LocalNetError {
  constructor(
    readonly phase: 'pull' | 'start' | 'init',
    readonly timeoutMs: number,
    readonly elapsedMs: number,
    /** The image being pulled when `phase` is `'pull'`. */
    readonly image: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A container stopped, turned unhealthy or never became healthy while `start()` waited for it.
 * Carries the container's last log lines, read before the failed start is rolled back (which
 * removes containers that start created, and their logs with them).
 */
export class ContainerStartupError extends LocalNetError {
  constructor(
    readonly container: string,
    /** Docker state when the wait gave up, e.g. `exited`, `restarting`, `running`. */
    readonly state: string,
    /** Up to the last 20 log lines; empty if the logs could not be read (the message says why). */
    readonly logTail: readonly string[],
    message: string,
  ) {
    super(message);
  }
}

/**
 * Initialization could not set up something the config asks for, and `start()` (or
 * `initializeResources()`, which `dnm init` runs) stops at the first such failure: a configured
 * party (`kind: 'party'`, `resource` is its hint), a configured user (`'user'`, its id), or the
 * validator itself (`'validator'`, its name) when its API, or for `sv` Scan, does not become ready,
 * or its hosted parties cannot be read to decide what to allocate. `cause` is the error that failed
 * it. What already exists counts as set up. A failed fresh start is rolled back; a failed resume
 * removes nothing.
 */
export class InitializationError extends LocalNetError {
  constructor(
    readonly kind: 'party' | 'user' | 'validator',
    readonly resource: string,
    readonly validator: string,
    message: string,
    options: { cause: unknown },
  ) {
    super(message, options);
  }
}

/**
 * What a failed `start()` could not undo. The error `start()` throws is still the startup error;
 * when the rollback could not remove or restore everything this start changed, it carries this as
 * `rollbackFailure`, and its message ends with the same list.
 */
export interface RollbackFailure {
  /** What is left, e.g. `container default-postgres`, `network denex.localnet-default`. */
  readonly leftBehind: readonly string[];
  /** The errors that stopped each of those steps, in the same order. */
  readonly errors: readonly unknown[];
}

/** The {@link RollbackFailure} a failed `start()` attached to its error, if there was one. */
export function rollbackFailureOf(error: unknown): RollbackFailure | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { rollbackFailure?: RollbackFailure }).rollbackFailure
    : undefined;
}
