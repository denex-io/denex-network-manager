import type { LocalNetConfig } from '../types/config.ts';
import { normalizeValidators } from '../types/config.ts';
import { parseLocalNetConfig } from '../schemas/mod.ts';

/**
 * Label key constants for Docker container labels.
 * These labels are used to store LocalNet configuration on containers
 * for later reconstruction via discovery.
 */
export const LABEL_PREFIX = 'denex.localnet';
export const LABEL_INSTANCE = `${LABEL_PREFIX}.instance`;
/** Full LocalNetConfig as JSON. Schema 2+. */
export const LABEL_CONFIG = `${LABEL_PREFIX}.config`;
export const LABEL_SCHEMA = `${LABEL_PREFIX}.schema`;

/**
 * Minimal container representation for discovery.
 * Contains only the fields needed to group containers by instance.
 */
export interface ContainerListItem {
  name: string;
  state: string;
  labels: Record<string, string>;
}

/**
 * Discovered LocalNet instance with aggregated metadata.
 * Represents a single LocalNet instance and its containers.
 */
export interface DiscoveredInstance {
  id: string;
  containerCount: number;
  status: 'running' | 'stopped' | 'mixed' | 'unsupported';
  basePort: number;
  validatorNames: string[];
}

/**
 * Reconstruct a LocalNetConfig from Docker container labels.
 *
 * Reads the denex.localnet.config label (schema 2) and re-validates via parseLocalNetConfig.
 * Returns null on schema mismatch, missing label, malformed JSON, or validation failure.
 *
 * @param labels - Docker container labels (Record<string, string>)
 * @returns LocalNetConfig if labels are valid, null otherwise
 */
export function reconstructConfigFromLabels(labels: Record<string, string>): LocalNetConfig | null {
  // Hardcoded prefix - instance-discovery labels do not respect labelPrefix option.
  const schema = labels['denex.localnet.schema'];
  if (schema !== '2') {
    return null;
  }

  const configJson = labels['denex.localnet.config'];
  if (!configJson) {
    return null;
  }

  try {
    const raw = JSON.parse(configJson);
    return parseLocalNetConfig(raw);
  } catch {
    return null;
  }
}

/**
 * Discover LocalNet instances from a list of containers.
 *
 * Groups containers by the `localnet.instance` label and extracts metadata
 * (basePort, validators, status) from each group. Containers without the
 * instance label are filtered out.
 *
 * @param containers - List of containers with labels
 * @returns Array of DiscoveredInstance objects, sorted by instance ID
 *
 * @example
 * ```typescript
 * const containers = [
 *   { name: 'postgres', state: 'running', labels: { 'localnet.instance': 'test-1', ... } },
 *   { name: 'canton', state: 'running', labels: { 'localnet.instance': 'test-1', ... } },
 * ];
 * const instances = discoverInstances(containers);
 * // Returns: [{ id: 'test-1', containerCount: 2, status: 'running', basePort: 5000, validatorNames: [...] }]
 * ```
 */
export function discoverInstances(containers: ContainerListItem[]): DiscoveredInstance[] {
  const instanceMap = new Map<string, DiscoveredInstance>();

  for (const container of containers) {
    const instanceId = container.labels[LABEL_INSTANCE];

    if (!instanceId) {
      continue;
    }

    if (!instanceMap.has(instanceId)) {
      const schema = container.labels[LABEL_SCHEMA];

      if (schema !== '2') {
        instanceMap.set(instanceId, {
          id: instanceId,
          containerCount: 0,
          status: 'unsupported',
          basePort: 0,
          validatorNames: [],
        });
      } else {
        // schema === '2' — derive basePort and validatorNames from the parsed config label.
        // The writer (LocalNet.buildContainerSpecs) only emits denex.localnet.{instance,config,schema};
        // there are NO per-field labels like localnet.basePort/localnet.validators on real containers.
        const config = reconstructConfigFromLabels(container.labels);
        if (!config) {
          // No usable config — schema mismatch, missing/malformed JSON, or validation failure.
          continue;
        }

        // validators may be a number (count) or an array of validator configs — normalize to array.
        const normalizedValidators = normalizeValidators(config.validators);
        const validatorNames = normalizedValidators.map((v) => v.name);

        instanceMap.set(instanceId, {
          id: instanceId,
          containerCount: 0,
          status: 'running',
          basePort: config.basePort ?? 5000,
          validatorNames,
        });
      }
    }

    const instance = instanceMap.get(instanceId)!;
    instance.containerCount++;

    if (instance.status === 'unsupported') {
      continue;
    }

    if (container.state === 'running') {
      if (instance.status !== 'mixed') {
        instance.status = 'running';
      }
    } else {
      instance.status = instance.status === 'running' ? 'mixed' : 'stopped';
    }
  }

  return Array.from(instanceMap.values()).sort((a, b) => a.id.localeCompare(b.id));
}
