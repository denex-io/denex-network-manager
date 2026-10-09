import { DockerClient } from './client.ts';
import type { NetworkInfo } from './types.ts';

export interface NetworkManagerOptions {
  prefix?: string;
}

export class NetworkManager {
  private client: DockerClient;
  private prefix: string;

  constructor(client: DockerClient, options?: NetworkManagerOptions) {
    this.client = client;
    this.prefix = options?.prefix ?? 'localnet';
  }

  private getNetworkName(instanceId: string): string {
    return `${this.prefix}-${instanceId}`;
  }

  async create(instanceId: string): Promise<string> {
    const name = this.getNetworkName(instanceId);
    const existing = await this.client.getNetworkInfo(name);

    if (existing) {
      return existing.id;
    }

    return this.client.createNetwork(name, {
      [`${this.prefix}.instance`]: instanceId,
    });
  }

  /**
   * Return the instance network, creating it if absent. `created` is true only
   * when this call created it, so callers can roll back exactly what they made.
   * Absence is decided by a 404-aware lookup: any other inspect error rejects
   * instead of being treated as "missing".
   */
  async ensure(instanceId: string): Promise<{ id: string; created: boolean }> {
    const name = this.getNetworkName(instanceId);
    const existing = await this.client.findNetwork(name);
    if (existing) {
      return { id: existing.id, created: false };
    }

    const id = await this.client.createNetwork(name, {
      [`${this.prefix}.instance`]: instanceId,
    });
    return { id, created: true };
  }

  async remove(instanceId: string): Promise<void> {
    const name = this.getNetworkName(instanceId);
    await this.client.removeNetwork(name);
  }

  get(instanceId: string): Promise<NetworkInfo | null> {
    const name = this.getNetworkName(instanceId);
    return this.client.getNetworkInfo(name);
  }

  async exists(instanceId: string): Promise<boolean> {
    const info = await this.get(instanceId);
    return info !== null;
  }

  async connectContainer(
    instanceId: string,
    containerId: string,
    aliases?: string[],
  ): Promise<void> {
    const name = this.getNetworkName(instanceId);
    await this.client.connectToNetwork(name, containerId, aliases);
  }

  getExpectedNetworkName(instanceId: string): string {
    return this.getNetworkName(instanceId);
  }
}
