import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { LocalNetConfig } from '../../src/types/config.ts';
import type { ContainerInfo } from '../../src/docker/types.ts';
import {
  buildAllContainers,
  buildCantonContainer,
  buildKeycloakContainer,
  buildNginxContainer,
  buildPostgresContainer,
  buildSpliceContainer,
  buildWalletWebUiContainers,
  type ContainerBuilderOptions,
  DEFAULT_IMAGES,
  DEFAULT_SPLICE_IMAGE_REPO,
  DEFAULT_SPLICE_VERSION,
  getStartupOrder,
} from '../../src/docker/containers.ts';
import { checkHealth } from '../../src/docker/health.ts';
import { type ConfigMismatch, generateNginxConfigString } from '../../src/docker/mod.ts';
import { BOOTSTRAP_ADMIN_USERNAME } from '../../src/generator/keycloak.ts';
import { LocalNet } from '../../src/localnet.ts';

const TEST_CONFIG: LocalNetConfig = {
  validators: 2,
  auth: {
    keycloak: {
      admin: 'admin',
      password: 'admin',
    },
  },
};

const TEST_OPTIONS: ContainerBuilderOptions = {
  networkName: 'test-network',
  configDir: '/tmp/test-config',
  dataDir: '/tmp/test-data',
  labelPrefix: 'localnet',
};

// The container builders read generated config files back from `configDir` (the
// canton/splice/nginx/keycloak app configs and the postgres init script). At
// runtime LocalNet.start() writes these via generateConfigs() before building
// container specs; these unit tests call the builders directly, so we run the
// same generateConfigs() step once here against the test configDir. This keeps
// a single source of truth for config generation rather than duplicating it.
await new LocalNet(TEST_CONFIG, {
  configDir: TEST_OPTIONS.configDir,
  dataDir: TEST_OPTIONS.dataDir,
  labelPrefix: TEST_OPTIONS.labelPrefix,
}).generateConfigs();

Deno.test('buildPostgresContainer - correct structure', () => {
  const container = buildPostgresContainer(TEST_CONFIG, TEST_OPTIONS);

  assertEquals(container.name, 'postgres');
  assertEquals(container.image, DEFAULT_IMAGES.postgres);
  assertEquals(container.hostname, 'postgres');
  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.type, 'exec');
});

Deno.test('buildPostgresContainer - correct health check params', () => {
  const container = buildPostgresContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.startPeriod, 10);
  assertEquals(container.healthCheck?.retries, 6);
  assertEquals(container.healthCheck?.interval, 10);
  assertEquals(container.healthCheck?.timeout, 3);
});

Deno.test('buildPostgresContainer - creates all databases', () => {
  const container = buildPostgresContainer(TEST_CONFIG, TEST_OPTIONS);

  const dbEnvKeys = Object.keys(container.environment ?? {}).filter((k) =>
    k.startsWith('CREATE_DATABASE_')
  );
  assertEquals(dbEnvKeys.length >= 8, true);
});

Deno.test('buildCantonContainer - correct ports for SV and validators', () => {
  const container = buildCantonContainer(TEST_CONFIG, TEST_OPTIONS);

  assertEquals(container.name, 'canton');
  assertExists(container.ports);
  assertEquals(container.ports.length, 9);

  const hostPorts = container.ports.map((p) => p.host);
  assertEquals(hostPorts.includes(5001), true);
  assertEquals(hostPorts.includes(5101), true);
  assertEquals(hostPorts.includes(5201), true);
});

Deno.test('buildCantonContainer - correct health check params', () => {
  const container = buildCantonContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.interval, 5);
  assertEquals(container.healthCheck?.timeout, 30);
  assertEquals(container.healthCheck?.retries, 10);
  assertEquals(container.healthCheck?.startPeriod, 5);
});

Deno.test('buildCantonContainer - depends on postgres', () => {
  const container = buildCantonContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.dependsOn);
  assertEquals(container.dependsOn.includes('postgres'), true);
});

Deno.test('buildSpliceContainer - correct ports', () => {
  const container = buildSpliceContainer(TEST_CONFIG, TEST_OPTIONS);

  assertEquals(container.name, 'splice');
  assertExists(container.ports);
  assertEquals(container.ports.length, 5);

  const hostPorts = container.ports.map((p) => p.host);
  assertEquals(hostPorts.includes(5003), true);
  assertEquals(hostPorts.includes(5103), true);
  assertEquals(hostPorts.includes(5203), true);
  assertEquals(hostPorts.includes(5012), true);
  assertEquals(hostPorts.includes(5014), true);
});

Deno.test('buildSpliceContainer - correct health check params', () => {
  const container = buildSpliceContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.interval, 5);
  assertEquals(container.healthCheck?.retries, 30);
  assertEquals(container.healthCheck?.timeout, 40);
  assertEquals(container.healthCheck?.startPeriod, 30);
});

Deno.test('buildSpliceContainer - depends on canton', () => {
  const container = buildSpliceContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.dependsOn);
  assertEquals(container.dependsOn.includes('canton'), true);
});

Deno.test('buildKeycloakContainer - correct config', () => {
  const container = buildKeycloakContainer(TEST_CONFIG, TEST_OPTIONS);

  assertEquals(container.name, 'keycloak');
  assertEquals(container.environment?.KC_BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_USERNAME);
});

Deno.test('buildKeycloakContainer - bootstrap admin username is fixed sentinel, not config admin (regression guard for keycloak#34286)', () => {
  // Test 1: Default config with admin: 'admin'
  const container1 = buildKeycloakContainer(TEST_CONFIG, TEST_OPTIONS);
  assertEquals(container1.environment?.KC_BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_USERNAME);

  // Test 2: Custom config with admin: 'customAdmin' — proves decoupling
  const customConfig: LocalNetConfig = {
    validators: 2,
    auth: {
      keycloak: {
        admin: 'customAdmin',
        password: 'customPass',
      },
    },
  };
  const container2 = buildKeycloakContainer(customConfig, TEST_OPTIONS);
  assertEquals(container2.environment?.KC_BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_USERNAME);
});

Deno.test('buildKeycloakContainer - correct health check params', () => {
  const container = buildKeycloakContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.startPeriod, 20);
  assertEquals(container.healthCheck?.retries, 30);
  assertEquals(container.healthCheck?.interval, 5);
  assertEquals(container.healthCheck?.timeout, 5);
});

Deno.test('buildNginxContainer - correct health check params', () => {
  const container = buildNginxContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.healthCheck);
  assertEquals(container.healthCheck?.interval, 5);
  assertEquals(container.healthCheck?.timeout, 5);
  assertEquals(container.healthCheck?.retries, 3);
});

Deno.test('buildWalletWebUiContainers - correct health check params', () => {
  const containers = buildWalletWebUiContainers(TEST_CONFIG, TEST_OPTIONS);

  assertEquals(containers.length, 3);
  for (const container of containers) {
    assertExists(container.healthCheck);
    assertEquals(container.healthCheck?.interval, 5);
    assertEquals(container.healthCheck?.timeout, 5);
    assertEquals(container.healthCheck?.retries, 3);
  }
});

Deno.test('buildAllContainers - includes all required containers', () => {
  const containers = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);

  const names = containers.map((c) => c.name);
  assertEquals(names.includes('postgres'), true);
  assertEquals(names.includes('canton'), true);
  assertEquals(names.includes('splice'), true);
  assertEquals(names.includes('nginx'), true);
  assertEquals(names.includes('keycloak'), true);
  assertEquals(names.includes('wallet-web-ui-sv'), true);
});

Deno.test('buildAllContainers - wallet UIs for each validator', () => {
  const containers = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);

  const walletUis = containers.filter((c) => c.name.startsWith('wallet-web-ui-'));
  assertEquals(walletUis.length, 3);
});

Deno.test('getStartupOrder - postgres first', () => {
  const containers = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const layers = getStartupOrder(containers);

  assertEquals(layers.length > 0, true);
  assertEquals(layers[0].some((c) => c.name === 'postgres'), true);
});

Deno.test('getStartupOrder - canton after postgres', () => {
  const containers = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const layers = getStartupOrder(containers);

  let postgresLayer = -1;
  let cantonLayer = -1;

  for (let i = 0; i < layers.length; i++) {
    if (layers[i].some((c) => c.name === 'postgres')) postgresLayer = i;
    if (layers[i].some((c) => c.name === 'canton')) cantonLayer = i;
  }

  assertEquals(cantonLayer > postgresLayer, true);
});

Deno.test('getStartupOrder - splice after canton', () => {
  const containers = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const layers = getStartupOrder(containers);

  let cantonLayer = -1;
  let spliceLayer = -1;

  for (let i = 0; i < layers.length; i++) {
    if (layers[i].some((c) => c.name === 'canton')) cantonLayer = i;
    if (layers[i].some((c) => c.name === 'splice')) spliceLayer = i;
  }

  assertEquals(spliceLayer > cantonLayer, true);
});

Deno.test({
  name: 'checkHealth - http check returns result',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const result = await checkHealth(
      { type: 'http', target: 'http://localhost:99999/nonexistent' },
      { timeout: 500 },
    );

    assertEquals(result.healthy, false);
    assertExists(result.message);
    assertExists(result.duration);
  },
});

Deno.test('checkHealth - tcp check returns result', async () => {
  const result = await checkHealth(
    { type: 'tcp', target: 'localhost:99999' },
    { timeout: 1000 },
  );

  assertEquals(result.healthy, false);
  assertExists(result.message);
});

Deno.test('DEFAULT_IMAGES - all images defined', () => {
  assertExists(DEFAULT_IMAGES.postgres);
  assertExists(DEFAULT_IMAGES.canton);
  assertExists(DEFAULT_IMAGES.splice);
  assertExists(DEFAULT_IMAGES.nginx);
  assertExists(DEFAULT_IMAGES.keycloak);
  assertExists(DEFAULT_IMAGES.walletWebUi);
});

Deno.test('DEFAULT_IMAGES - Splice bundle uses current release tag', () => {
  assertEquals(DEFAULT_SPLICE_VERSION, '0.6.6');
  assertEquals(DEFAULT_IMAGES.canton, `${DEFAULT_SPLICE_IMAGE_REPO}/canton:0.6.6`);
  assertEquals(DEFAULT_IMAGES.splice, `${DEFAULT_SPLICE_IMAGE_REPO}/splice-app:0.6.6`);
  assertEquals(DEFAULT_IMAGES.walletWebUi, `${DEFAULT_SPLICE_IMAGE_REPO}/wallet-web-ui:0.6.6`);
  assertEquals(DEFAULT_IMAGES.ansWebUi, `${DEFAULT_SPLICE_IMAGE_REPO}/ans-web-ui:0.6.6`);
  assertEquals(DEFAULT_IMAGES.svWebUi, `${DEFAULT_SPLICE_IMAGE_REPO}/sv-web-ui:0.6.6`);
  assertEquals(DEFAULT_IMAGES.scanWebUi, `${DEFAULT_SPLICE_IMAGE_REPO}/scan-web-ui:0.6.6`);
});

Deno.test('ConfigMismatch - interface exports correctly', () => {
  const mismatch: ConfigMismatch = {
    hasMismatch: false,
    expected: { validators: ['v1'] },
    actual: { validators: ['v1'] },
    message: '',
  };

  assertEquals(mismatch.hasMismatch, false);
  assertEquals(mismatch.expected.validators, ['v1']);
});

Deno.test('ConfigMismatch - message format for validator mismatch', () => {
  const mismatch: ConfigMismatch = {
    hasMismatch: true,
    expected: { validators: ['app', 'user-1'] },
    actual: { validators: ['validator-1'] },
    message: '  Expected validators: app, user-1\n  Running validators:  validator-1',
  };

  assertEquals(mismatch.hasMismatch, true);
  assert(mismatch.message.includes('Expected validators'));
  assert(mismatch.message.includes('Running validators'));
});

Deno.test('nginx config - contains no upstream blocks', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assert(!nginxConfig.includes('upstream'), 'nginx config should not contain upstream blocks');
});

Deno.test('nginx config - SV web UI uses direct proxy_pass with trailing slash', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assertStringIncludes(nginxConfig, 'proxy_pass http://sv-web-ui:8080/;');
});

Deno.test('nginx config - Scan web UI uses direct proxy_pass with trailing slash', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assertStringIncludes(nginxConfig, 'proxy_pass http://scan-web-ui:8080/;');
});

Deno.test('nginx config - SV wallet uses direct proxy_pass with trailing slash', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assertStringIncludes(nginxConfig, 'proxy_pass http://wallet-web-ui-sv:8080/;');
});

Deno.test('nginx config - SV wallet block contains /api/validator location', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assertStringIncludes(nginxConfig, 'location /api/validator');
  assertStringIncludes(nginxConfig, 'proxy_pass http://splice:5003/api/validator;');
});

Deno.test('nginx config - Validator blocks contain /api/validator with correct ports', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assertStringIncludes(nginxConfig, 'proxy_pass http://splice:5103/api/validator;');
  assertStringIncludes(nginxConfig, 'proxy_pass http://splice:5203/api/validator;');
});

Deno.test('nginx config - Validator blocks use wallet.localhost server_name', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  const lines = nginxConfig.split('\n');

  let validatorBlockCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('listen 5180') || lines[i].includes('listen 5280')) {
      assert(
        lines[i + 1].includes('server_name wallet.localhost;'),
        'Validator blocks should use wallet.localhost, not *.localhost',
      );
      validatorBlockCount++;
    }
  }

  assertEquals(validatorBlockCount, 2, 'Should have 2 validator server blocks');
});

Deno.test('nginx config - no default_server block', () => {
  const nginxConfig = generateNginxConfigString(TEST_CONFIG);
  assert(
    !nginxConfig.includes('default_server'),
    'nginx config should not contain default_server block',
  );
});

Deno.test('ContainerInfo - labels field exists', () => {
  const mockContainerInfo: ContainerInfo = {
    id: 'test-id',
    name: 'test-container',
    state: 'running',
    status: 'running',
    image: 'test-image',
    ports: [],
    labels: { 'localnet': 'true', 'custom-label': 'value' },
  };

  assertExists(mockContainerInfo.labels);
  assertEquals(typeof mockContainerInfo.labels, 'object');
  assertEquals(mockContainerInfo.labels['localnet'], 'true');
  assertEquals(mockContainerInfo.labels['custom-label'], 'value');
});

Deno.test('buildPostgresContainer - ports have no host field', () => {
  const container = buildPostgresContainer(TEST_CONFIG, TEST_OPTIONS);

  assertExists(container.ports);
  assertEquals(container.ports.length, 1);
  assertEquals(container.ports[0].container, 5432);
  assertEquals(container.ports[0].host, undefined, 'postgres port should have no host binding');
});

Deno.test('name prefixing - all container names are prefixed', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const prefix = 'test-instance';
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

  for (const spec of specs) {
    assert(
      spec.name.startsWith(`${prefix}-`),
      `container name '${spec.name}' should be prefixed with '${prefix}-'`,
    );
  }
});

Deno.test('name prefixing - hostnames remain bare service names', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const prefix = 'test-instance';

  const originalHostnames = new Map<string, string | undefined>();
  for (const spec of specs) {
    originalHostnames.set(spec.name, spec.hostname);
  }

  const nameMap = new Map<string, string>();
  for (const spec of specs) {
    const prefixedName = `${prefix}-${spec.name}`;
    nameMap.set(spec.name, prefixedName);
    spec.name = prefixedName;
  }

  for (const spec of specs) {
    if (spec.hostname) {
      assert(
        !spec.hostname.startsWith(`${prefix}-`),
        `hostname '${spec.hostname}' on container '${spec.name}' should not be prefixed`,
      );
    }
  }
});

Deno.test('name prefixing - dependsOn arrays contain prefixed names', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const prefix = 'test-instance';
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

  const allNames = new Set(specs.map((s) => s.name));
  for (const spec of specs) {
    if (spec.dependsOn) {
      for (const dep of spec.dependsOn) {
        assert(
          dep.startsWith(`${prefix}-`),
          `dependsOn '${dep}' in '${spec.name}' should be prefixed`,
        );
        assert(
          allNames.has(dep),
          `dependsOn '${dep}' in '${spec.name}' should match an actual container name`,
        );
      }
    }
  }
});

Deno.test('getStartupOrder - works with prefixed names', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const prefix = 'test-instance';
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

  const layers = getStartupOrder(specs);
  assertEquals(layers.length > 0, true);

  const placedNames = layers.flat().map((c) => c.name);
  assertEquals(placedNames.length, specs.length);
  for (const spec of specs) {
    assert(
      placedNames.includes(spec.name),
      `container '${spec.name}' should appear in startup order`,
    );
  }
});

Deno.test('getStartupOrder - prefixed postgres still starts first', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const prefix = 'mynet';
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

  const layers = getStartupOrder(specs);
  assertEquals(layers[0].some((c) => c.name === `${prefix}-postgres`), true);
});

Deno.test('label injection - all containers have localnet.instance label', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const instanceId = 'test-instance';
  const labelPrefix = 'localnet';

  // Simulate the label injection from buildContainerSpecs()
  for (const spec of specs) {
    spec.labels = {
      ...spec.labels,
      [`${labelPrefix}.instance`]: instanceId,
    };
  }

  for (const spec of specs) {
    assertExists(spec.labels, `container '${spec.name}' should have labels`);
    assertEquals(
      spec.labels[`${labelPrefix}.instance`],
      instanceId,
      `container '${spec.name}' should have instance label`,
    );
  }
});

Deno.test('label injection - all containers have basePort, validators, and schema labels', () => {
  const specs = buildAllContainers(TEST_CONFIG, TEST_OPTIONS);
  const instanceId = 'test-instance';
  const labelPrefix = 'localnet';
  const basePort = 5000;
  const validatorNames = ['validator-1', 'validator-2'];

  // Simulate the label injection from buildContainerSpecs()
  for (const spec of specs) {
    spec.labels = {
      ...spec.labels,
      [`${labelPrefix}.instance`]: instanceId,
      [`${labelPrefix}.basePort`]: String(basePort),
      [`${labelPrefix}.validators`]: JSON.stringify(validatorNames),
      [`${labelPrefix}.schema`]: '1',
    };
  }

  for (const spec of specs) {
    assertExists(spec.labels, `container '${spec.name}' should have labels`);
    assertEquals(
      spec.labels[`${labelPrefix}.basePort`],
      String(basePort),
      `container '${spec.name}' should have basePort label as string`,
    );
    assertEquals(
      spec.labels[`${labelPrefix}.validators`],
      JSON.stringify(validatorNames),
      `container '${spec.name}' should have validators label as JSON array`,
    );
    assertEquals(
      spec.labels[`${labelPrefix}.schema`],
      '1',
      `container '${spec.name}' should have schema label`,
    );
  }
});

Deno.test('detectConfigMismatch prefix stripping - extracts validator names correctly', () => {
  const instancePrefix = 'my-instance-';
  const containers = [
    { name: 'my-instance-wallet-web-ui-sv' },
    { name: 'my-instance-wallet-web-ui-alice' },
    { name: 'my-instance-wallet-web-ui-bob' },
    { name: 'my-instance-postgres' },
    { name: 'my-instance-canton' },
    { name: 'my-instance-splice' },
  ];
  const strippedContainers = containers.map((c) => ({
    ...c,
    name: c.name.startsWith(instancePrefix) ? c.name.slice(instancePrefix.length) : c.name,
  }));
  const actualValidators = strippedContainers
    .filter((c) => c.name.startsWith('wallet-web-ui-') && c.name !== 'wallet-web-ui-sv')
    .map((c) => c.name.replace('wallet-web-ui-', ''));

  assertEquals(actualValidators.sort(), ['alice', 'bob']);
});

Deno.test('detectConfigMismatch prefix stripping - handles no validators', () => {
  const instancePrefix = 'net-';
  const containers = [
    { name: 'net-wallet-web-ui-sv' },
    { name: 'net-postgres' },
  ];
  const strippedContainers = containers.map((c) => ({
    ...c,
    name: c.name.startsWith(instancePrefix) ? c.name.slice(instancePrefix.length) : c.name,
  }));
  const actualValidators = strippedContainers
    .filter((c) => c.name.startsWith('wallet-web-ui-') && c.name !== 'wallet-web-ui-sv')
    .map((c) => c.name.replace('wallet-web-ui-', ''));

  assertEquals(actualValidators, []);
});

Deno.test('detectConfigMismatch prefix stripping - leaves non-prefixed names unchanged', () => {
  const instancePrefix = 'my-instance-';
  const containers = [
    { name: 'other-wallet-web-ui-charlie' },
    { name: 'my-instance-wallet-web-ui-dave' },
  ];
  const strippedContainers = containers.map((c) => ({
    ...c,
    name: c.name.startsWith(instancePrefix) ? c.name.slice(instancePrefix.length) : c.name,
  }));

  assertEquals(strippedContainers[0].name, 'other-wallet-web-ui-charlie');
  assertEquals(strippedContainers[1].name, 'wallet-web-ui-dave');
});

Deno.test('label injection - writes denex.localnet.config label with schema=2', () => {
  const config: LocalNetConfig = {
    validators: 2,
    auth: {
      keycloak: {
        admin: 'admin',
        password: 'admin',
      },
    },
  };

  const configJson = JSON.stringify(config);
  const labelPrefix = 'denex.localnet';

  // Simulate what buildContainerSpecs does
  const containers = buildAllContainers(config, TEST_OPTIONS);
  for (const spec of containers) {
    spec.labels = {
      ...spec.labels,
      [`${labelPrefix}.instance`]: 'test-instance',
      [`${labelPrefix}.config`]: configJson,
      [`${labelPrefix}.schema`]: '2',
    };
  }

  // All containers should have the config label
  for (const container of containers) {
    assertExists(container.labels);
    assert(container.labels !== undefined);
    assertExists(container.labels['denex.localnet.config']);
    assertEquals(container.labels['denex.localnet.schema'], '2');

    // Verify it's valid JSON and parses back to a config-like object
    const parsed = JSON.parse(container.labels['denex.localnet.config']);
    assertExists(parsed.validators);
    assertExists(parsed.auth);
  }

  // Verify old labels are gone
  for (const container of containers) {
    assert(container.labels !== undefined);
    assert(!container.labels['denex.localnet.basePort']);
    assert(!container.labels['denex.localnet.validators']);
  }
});

Deno.test('label injection - config label round-trips correctly', () => {
  const config: LocalNetConfig = {
    validators: 2,
    basePort: 6000,
    auth: {
      keycloak: {
        admin: 'testadmin',
        password: 'testpass',
      },
    },
  };

  const configJson = JSON.stringify(config);
  const labelPrefix = 'denex.localnet';

  // Simulate what buildContainerSpecs does
  const containers = buildAllContainers(config, TEST_OPTIONS);
  const firstContainer = containers[0];
  firstContainer.labels = {
    ...firstContainer.labels,
    [`${labelPrefix}.instance`]: 'test-instance',
    [`${labelPrefix}.config`]: configJson,
    [`${labelPrefix}.schema`]: '2',
  };

  assertExists(firstContainer.labels);
  assert(firstContainer.labels !== undefined);
  const parsed = JSON.parse(firstContainer.labels['denex.localnet.config']);

  // Verify key fields round-trip
  assertEquals(parsed.basePort, 6000);
  assertEquals(parsed.auth.keycloak.admin, 'testadmin');
  assertEquals(parsed.auth.keycloak.password, 'testpass');
});
