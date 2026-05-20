import { assertEquals, assertRejects } from '@std/assert';
import { LocalNet } from '../../src/localnet.ts';
import { DockerClient } from '../../src/docker/client.ts';
import { reconstructConfigFromLabels } from '../../src/api/discovery-utils.ts';
import { isDockerAvailable } from './helpers.ts';

Deno.test('config recovery from running instance via Docker labels', async () => {
  if (!await isDockerAvailable()) {
    console.warn('Skipped: Docker unavailable');
    return;
  }

  const instanceId = `recovery-${Date.now()}`;
  const localnet = await LocalNet.fromConfig({
    version: '1.0',
    basePort: 5500,
    validators: 1,
    auth: { keycloak: { admin: 'realadmin', password: 'realpassword123' } },
  }, { instanceId });

  try {
    await localnet.start({ skipHealthChecks: true, skipInitialization: true });

    const dockerClient = new DockerClient();
    const containers = await dockerClient.listContainers({
      'denex.localnet.instance': instanceId,
    });
    assertEquals(containers.length > 0, true);
    const labels = containers[0].labels;
    assertEquals(labels['denex.localnet.schema'], '2');
    assertEquals(labels['denex.localnet.basePort'], undefined);
    assertEquals(labels['denex.localnet.validators'], undefined);
    assertEquals(typeof labels['denex.localnet.config'], 'string');

    const parsed = JSON.parse(labels['denex.localnet.config']);
    assertEquals(parsed.auth.keycloak.admin, 'realadmin');
    assertEquals(parsed.auth.keycloak.password, 'realpassword123');

    const recovered = reconstructConfigFromLabels(labels);
    assertEquals(recovered !== null, true);
    assertEquals(recovered!.auth.keycloak.admin, 'realadmin');

    const attached = await LocalNet.fromInstanceId(instanceId);
    assertEquals(attached.getConfig().auth.keycloak.admin, 'realadmin');

    const discovered = await LocalNet.discover();
    const found = discovered.find((i) => i.id === instanceId);
    assertEquals(found !== undefined, true);
    assertEquals(found!.status, 'running');
    assertEquals(found!.basePort, 5500);

    const credentials = await attached.getCredentials();
    assertEquals(credentials.length > 0, true);

    await localnet.start({ skipHealthChecks: true, skipInitialization: true });
  } finally {
    await localnet.destroy({ removeVolumes: true });
  }
});

Deno.test('Tier 3 method throws on stopped instance', async () => {
  if (!await isDockerAvailable()) {
    console.warn('Skipped: Docker unavailable');
    return;
  }

  const localnet = await LocalNet.fromConfig({
    version: '1.0',
    validators: 1,
    auth: { keycloak: { admin: 'a', password: 'b' } },
  }, { instanceId: `tier3-${Date.now()}` });

  await assertRejects(
    () => localnet.getParties(),
    Error,
    'not running',
  );
});

Deno.test('start with mismatched config throws', async () => {
  if (!await isDockerAvailable()) {
    console.warn('Skipped: Docker unavailable');
    return;
  }

  const instanceId = `mismatch-${Date.now()}`;
  const localnet1 = await LocalNet.fromConfig({
    version: '1.0',
    basePort: 5600,
    validators: 1,
    auth: { keycloak: { admin: 'a', password: 'b' } },
  }, { instanceId });

  try {
    await localnet1.start({ skipHealthChecks: true, skipInitialization: true });

    const localnet2 = await LocalNet.fromConfig({
      version: '1.0',
      basePort: 5700,
      validators: 2,
      auth: { keycloak: { admin: 'a', password: 'b' } },
    }, { instanceId });

    await assertRejects(
      () => localnet2.start({ skipHealthChecks: true, skipInitialization: true }),
      Error,
      'already running with a different config',
    );
  } finally {
    await localnet1.destroy({ removeVolumes: true });
  }
});
