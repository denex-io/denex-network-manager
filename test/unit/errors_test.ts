// Each error class reports its own name and stays an instance of its base classes. LocalNetError
// sets `name` from `this.constructor`, not `new.target`, because dnt treats `new.target` like
// `import.meta` and breaks the npm build (see src/errors.ts).
import { assertEquals, assertInstanceOf } from '@std/assert';
import {
  ContainerStartupError,
  InitializationError,
  InstanceMismatchError,
  LocalNetError,
  SpliceVersionConflictError,
  StartupTimeoutError,
} from '../../src/errors.ts';

const errors: [string, LocalNetError][] = [
  ['LocalNetError', new LocalNetError('m')],
  ['InstanceMismatchError', new InstanceMismatchError('default', [], 'm')],
  ['SpliceVersionConflictError', new SpliceVersionConflictError('0.9.4', 'image', 'm')],
  ['StartupTimeoutError', new StartupTimeoutError('init', 1000, 1001, undefined, 'm')],
  ['ContainerStartupError', new ContainerStartupError('default-splice', 'exited', [], 'm')],
  [
    'InitializationError',
    new InitializationError('party', 'alice', 'app', 'm', { cause: new Error('c') }),
  ],
];

for (const [name, error] of errors) {
  Deno.test(`${name}: name is the class name`, () => {
    assertEquals(error.name, name);
    assertEquals(String(error), `${name}: m`);
    assertInstanceOf(error, LocalNetError);
    assertInstanceOf(error, Error);
  });
}
