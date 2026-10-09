import { assertEquals, assertRejects } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { createMinimalConfig } from '../../src/utils/yaml.ts';

// initializeResources() with its Docker/API dependencies stubbed: only the
// party pre-check is under test.
async function setup(hosted: string[]) {
  const config = createMinimalConfig(1);
  config.validators = [
    { name: 'validator-1', parties: [{ hint: 'alice' }, { hint: 'bob' }] },
  ];
  const net = await LocalNet.fromConfig(config, { instanceId: 'inittest' });
  const allocated: string[] = [];
  Reflect.set(net, 'waitForApisReady', () => Promise.resolve());
  Reflect.set(net, 'waitForScanActive', () => Promise.resolve());
  Reflect.set(net, 'fetchHostedParties', () =>
    Promise.resolve({
      participantId: 'p',
      parties: hosted.map((h) => ({ party: `${h}::ns`, isLocal: true })),
    }));
  Reflect.set(net, 'allocateParty', (hint: string) => {
    allocated.push(hint);
    return Promise.resolve({ partyId: `${hint}::ns` });
  });
  return { net, allocated };
}

Deno.test('initializeResources skips parties whose hint is already hosted', async () => {
  const { net, allocated } = await setup(['alice']);
  const messages: string[] = [];
  await net.initializeResources((m) => messages.push(m));
  assertEquals(allocated, ['bob']);
  assertEquals(messages.some((m) => m.includes("'alice' already allocated")), true);
});

Deno.test('initializeResources allocates everything when nothing exists', async () => {
  const { net, allocated } = await setup([]);
  await net.initializeResources();
  assertEquals(allocated, ['alice', 'bob']);
});

Deno.test('initializeResources is a no-op for parties when all already exist', async () => {
  const { net, allocated } = await setup(['alice', 'bob']);
  await net.initializeResources();
  assertEquals(allocated, []);
});

Deno.test('initializeResources rejects, without allocating, when the hosted-party query fails', async () => {
  const { net, allocated } = await setup([]);
  Reflect.set(net, 'fetchHostedParties', () => Promise.reject(new Error('boom')));
  await assertRejects(() => net.initializeResources(), Error, "'validator-1'");
  assertEquals(allocated, []);
});
