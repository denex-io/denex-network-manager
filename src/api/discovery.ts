import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import process from 'node:process';
import type { LocalNetConfig } from '../types/config.ts';
import { buildConfigEnvironmentInfo } from '../utils/env-info.ts';
import type { ApiPackageInfo, ApiPartyInfo, ApiValidatorState } from './state-types.ts';
import type { DockerClient } from '../docker/client.ts';
import {
  type DiscoveredInstance,
  discoverInstances,
  LABEL_INSTANCE,
  reconstructConfigFromLabels,
} from './discovery-utils.ts';
import { LocalNet } from '../localnet.ts';

export interface MultiInstanceDiscoveryServerOptions {
  port?: number;
  host?: string;
  cacheTtlMs?: number;
}

export interface StatusResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  validators: ApiValidatorState[];
  timestamp: string;
}

export interface PartiesResponse {
  parties: ApiPartyInfo[];
  count: number;
}

export interface PackagesResponse {
  packages: ApiPackageInfo[];
  count: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MultiInstanceDiscoveryServer {
  private app: Hono;
  private dockerClient: DockerClient;
  private options: Required<MultiInstanceDiscoveryServerOptions>;
  private instanceCache: CacheEntry<DiscoveredInstance[]> | null = null;
  private configCache: Map<string, LocalNetConfig> = new Map();
  private localnetCache: Map<string, LocalNet> = new Map();
  private server: Server | null = null;
  private signalHandler: (() => void) | null = null;

  constructor(
    dockerClient: DockerClient,
    options?: MultiInstanceDiscoveryServerOptions,
  ) {
    this.dockerClient = dockerClient;
    this.options = {
      port: options?.port ?? 9000,
      host: options?.host ?? 'localhost',
      cacheTtlMs: options?.cacheTtlMs ?? 30_000,
    };
    this.app = this.createApp();
  }

  private createApp(): Hono {
    const app = new Hono();

    app.use('*', cors());

    app.get('/health', (c): Response => {
      return c.json({ status: 'ok' });
    });

    app.get('/instances', async (c): Promise<Response> => {
      const instances = await this.getInstances();
      return c.json(instances);
    });

    app.get('/instances/:id/status', async (c): Promise<Response> => {
      const id = c.req.param('id');
      const instance = await this.findInstance(id);
      if (!instance) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      if (instance.status === 'unsupported') {
        return c.json(
          {
            error: 'Instance uses unsupported schema',
            instanceId: id,
            remediation: `Run \`denex-localnet destroy --instance ${id}\` and start it again.`,
          },
          410,
        );
      }

      const localnet = await this.getLocalNet(id);
      if (!localnet) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      const validators = await localnet.getAllValidatorStates();
      const healthyCount = validators.filter((v) => v.isHealthy).length;
      const totalCount = validators.length;

      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (healthyCount === totalCount) {
        status = 'healthy';
      } else if (healthyCount > 0) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      const response: StatusResponse = {
        status,
        validators,
        timestamp: new Date().toISOString(),
      };

      return c.json(response);
    });

    app.get('/instances/:id/parties', async (c): Promise<Response> => {
      const id = c.req.param('id');
      const instance = await this.findInstance(id);
      if (!instance) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      if (instance.status === 'unsupported') {
        return c.json(
          {
            error: 'Instance uses unsupported schema',
            instanceId: id,
            remediation: `Run \`denex-localnet destroy --instance ${id}\` and start it again.`,
          },
          410,
        );
      }

      const localnet = await this.getLocalNet(id);
      if (!localnet) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      const parties = await localnet.getParties();
      const response: PartiesResponse = { parties, count: parties.length };
      return c.json(response);
    });

    app.get('/instances/:id/packages', async (c): Promise<Response> => {
      const id = c.req.param('id');
      const instance = await this.findInstance(id);
      if (!instance) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      if (instance.status === 'unsupported') {
        return c.json(
          {
            error: 'Instance uses unsupported schema',
            instanceId: id,
            remediation: `Run \`denex-localnet destroy --instance ${id}\` and start it again.`,
          },
          410,
        );
      }

      const localnet = await this.getLocalNet(id);
      if (!localnet) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      const packages = await localnet.getPackages();
      const response: PackagesResponse = { packages, count: packages.length };
      return c.json(response);
    });

    app.get('/instances/:id/env', async (c): Promise<Response> => {
      const id = c.req.param('id');
      const instance = await this.findInstance(id);
      if (!instance) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      if (instance.status === 'unsupported') {
        return c.json(
          {
            error: 'Instance uses unsupported schema',
            instanceId: id,
            remediation: `Run \`denex-localnet destroy --instance ${id}\` and start it again.`,
          },
          410,
        );
      }

      const config = await this.getInstanceConfig(id);
      if (!config) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      const env = buildConfigEnvironmentInfo(config);
      return c.json(env);
    });

    app.get('/instances/:id/snapshot', async (c): Promise<Response> => {
      const id = c.req.param('id');
      const instance = await this.findInstance(id);
      if (!instance) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      if (instance.status === 'unsupported') {
        return c.json(
          {
            error: 'Instance uses unsupported schema',
            instanceId: id,
            remediation: `Run \`denex-localnet destroy --instance ${id}\` and start it again.`,
          },
          410,
        );
      }

      const localnet = await this.getLocalNet(id);
      if (!localnet) {
        return c.json({ error: 'Instance not found', instanceId: id }, 404);
      }

      const snapshot = await localnet.getSnapshot();
      return c.json({
        ...snapshot,
        timestamp: snapshot.timestamp.toISOString(),
      });
    });

    return app;
  }

  get honoApp(): Hono {
    return this.app;
  }

  async discoverAndCache(): Promise<DiscoveredInstance[]> {
    const containers = await this.dockerClient.listContainers();
    const instances = discoverInstances(containers);

    this.instanceCache = {
      data: instances,
      expiresAt: Date.now() + this.options.cacheTtlMs,
    };

    this.configCache.clear();
    this.localnetCache.clear();
    for (const container of containers) {
      const instanceId = container.labels?.[LABEL_INSTANCE];
      if (instanceId && !this.configCache.has(instanceId)) {
        const config = reconstructConfigFromLabels(container.labels);
        if (config) {
          this.configCache.set(instanceId, config);
        }
      }
    }

    return instances;
  }

  private async getInstances(): Promise<DiscoveredInstance[]> {
    if (this.instanceCache && Date.now() < this.instanceCache.expiresAt) {
      return this.instanceCache.data;
    }
    return await this.discoverAndCache();
  }

  private async findInstance(id: string): Promise<DiscoveredInstance | null> {
    const instances = await this.getInstances();
    return instances.find((i) => i.id === id) ?? null;
  }

  private async getInstanceConfig(id: string): Promise<LocalNetConfig | null> {
    if (!this.configCache.has(id)) {
      await this.discoverAndCache();
    }
    return this.configCache.get(id) ?? null;
  }

  private async getLocalNet(instanceId: string): Promise<LocalNet | null> {
    const cached = this.localnetCache.get(instanceId);
    if (cached) return cached;

    try {
      const localnet = await LocalNet.fromInstanceId(instanceId);
      this.localnetCache.set(instanceId, localnet);
      return localnet;
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    this.signalHandler = () => {
      console.log('Shutting down discovery server...');
      this.stop();
    };

    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);

    this.server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = `http://${this.options.host}:${this.options.port}${req.url}`;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
        }
        const request = new Request(url, {
          method: req.method ?? 'GET',
          headers,
        });
        const response = await this.app.fetch(request);

        res.writeHead(
          response.status,
          Object.fromEntries(response.headers.entries()),
        );
        const body = await response.arrayBuffer();
        res.end(Buffer.from(body));
      },
    );

    await new Promise<void>((resolve) => {
      this.server!.listen(this.options.port, this.options.host, () => resolve());
    });

    console.log(
      `Discovery server listening on http://${this.options.host}:${this.options.port}`,
    );
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    if (this.signalHandler) {
      process.off('SIGINT', this.signalHandler);
      process.off('SIGTERM', this.signalHandler);
      this.signalHandler = null;
    }
  }
}
