/**
 * The integration groups. Each group runs as one job, through run_group.ts. A group's
 * `networks` are started once for all its files (shared_localnet.ts), and are up together while
 * the files run; every other LocalNet in the group belongs to the test that starts it.
 *
 * test/unit/integration_groups_test.ts checks that every integration test file is in exactly
 * one group.
 */

import type { SharedNetworkName } from './shared_localnet.ts';

export interface IntegrationGroup {
  /** The shared networks the group's files attach to, started once by run_group.ts, in order. */
  networks?: SharedNetworkName[];
  /** Test files in test/integration/, run in this order. */
  files: string[];
}

export const GROUPS: Record<string, IntegrationGroup> = {
  s1: {
    networks: ['S1'],
    files: ['splice_version_test.ts', 'auth_confidence_test.ts', 'operator_apis_test.ts'],
  },
  s2: {
    networks: ['S2'],
    files: ['wallet_ui_test.ts', 'runtime_user_test.ts', 'transfer_test.ts'],
  },
  init: {
    networks: ['INIT'],
    files: ['initialization_test.ts', 'entitlements_test.ts'],
  },
  // "manual initializeResources works after skipInitialization" initializes its network, so it
  // starts its own, beside SKIP.
  skip: {
    networks: ['SKIP'],
    files: ['skip_initialization_test.ts', 'keycloak_master_realm_test.ts'],
  },
  // Dedicated networks only: each test that needs one starts it. One LocalNet start per group
  // where a file has one test.
  packages: { files: ['packages_test.ts'] },
  'packages-config': { files: ['packages_config_test.ts'] },
  e2e: { files: ['e2e_browser_test.ts'] },
  lifecycle: {
    files: [
      'cli_test.ts',
      'config_recovery_test.ts',
      'multi_instance_test.ts',
      'docker_client_test.ts',
      'network_test.ts',
      'postgres_test.ts',
      'postgres_volume_test.ts',
    ],
  },
  localnet: { files: ['localnet_test.ts'] },
};
