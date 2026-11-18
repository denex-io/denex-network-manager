/**
 * Errors denex-network-manager raises on purpose. Every one extends {@link LocalNetError}, so
 * `err instanceof LocalNetError` tells them apart from Docker, network and programming errors.
 * Config validation errors are `ZodError`s and are not part of this hierarchy.
 */

/** Base class for the errors this package raises on purpose. */
export class LocalNetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
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
 * repair would create containers next to ones running another image or host binding.
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
 * Docker could not publish a host port on the address `hostBindIp` names: the address is not
 * assigned to the Docker host. `start()` throws it instead of Docker's bare bind error.
 */
export class HostBindError extends LocalNetError {
  constructor(
    readonly address: string,
    readonly port: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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
