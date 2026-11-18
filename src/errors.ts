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
  field: 'config' | 'image' | 'hostBindings';
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
