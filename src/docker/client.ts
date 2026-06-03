/// <reference types="npm:@types/node" />
import Dockerode from 'dockerode';
import type {
  ContainerInfo,
  ContainerSpec,
  ContainerState,
  NetworkInfo,
  PortBinding,
  VolumeInfo,
} from './types.ts';

export interface DockerClientOptions {
  labelPrefix?: string;
  dockerOptions?: Dockerode.DockerOptions;
}

const DEFAULT_LABEL_PREFIX = 'denex.localnet';

export class DockerClient {
  private docker: Dockerode;
  private labelPrefix: string;

  constructor(options?: DockerClientOptions) {
    this.docker = new Dockerode(options?.dockerOptions);
    this.labelPrefix = options?.labelPrefix ?? DEFAULT_LABEL_PREFIX;
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async pullImage(image: string, onProgress?: (event: unknown) => void): Promise<void> {
    const stream = await this.docker.pull(image);
    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
        onProgress,
      );
    });
  }

  async imageExists(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async createContainer(spec: ContainerSpec): Promise<string> {
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, object> = {};

    for (const port of spec.ports ?? []) {
      const key = `${port.container}/${port.protocol ?? 'tcp'}`;
      exposedPorts[key] = {};
      if (port.host !== undefined) {
        portBindings[key] = [{ HostPort: String(port.host) }];
      }
    }

    const binds = (spec.volumes ?? []).map((v) =>
      v.readonly ? `${v.source}:${v.target}:ro` : `${v.source}:${v.target}`
    );

    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Env: spec.environment
        ? Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`)
        : undefined,
      ExposedPorts: exposedPorts,
      Cmd: spec.command,
      Entrypoint: spec.entrypoint,
      WorkingDir: spec.workingDir,
      Hostname: spec.hostname,
      Labels: {
        ...spec.labels,
        [this.labelPrefix]: 'true',
      },
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: spec.networks?.[0],
        Memory: spec.memoryLimit,
        NanoCpus: spec.cpuLimit ? spec.cpuLimit * 1e9 : undefined,
        RestartPolicy: spec.restart ? { Name: spec.restart } : undefined,
      },
      Healthcheck: spec.healthCheck ? this.buildHealthCheck(spec.healthCheck) : undefined,
    });

    return container.id;
  }

  private buildHealthCheck(
    config: ContainerSpec['healthCheck'],
  ): Dockerode.HealthConfig | undefined {
    if (!config) return undefined;

    const interval = (config.interval ?? 10) * 1e9;
    const timeout = (config.timeout ?? 5) * 1e9;
    const retries = config.retries ?? 3;
    const startPeriod = (config.startPeriod ?? 30) * 1e9;

    let test: string[];
    switch (config.type) {
      case 'http':
        test = [
          'CMD-SHELL',
          `(wget -q --spider ${config.target} || curl -sf ${config.target} >/dev/null) || exit 1`,
        ];
        break;
      case 'tcp':
        test = [
          'CMD-SHELL',
          `(nc -z localhost ${config.target} || (echo >/dev/tcp/localhost/${config.target})) 2>/dev/null || exit 1`,
        ];
        break;
      case 'exec':
        test = ['CMD-SHELL', config.target];
        break;
      case 'grpc':
        test = ['CMD-SHELL', `grpc_health_probe -addr=${config.target} || exit 1`];
        break;
      default:
        return undefined;
    }

    return {
      Test: test,
      Interval: interval,
      Timeout: timeout,
      Retries: retries,
      StartPeriod: startPeriod,
    };
  }

  async startContainer(idOrName: string): Promise<void> {
    try {
      await this.docker.getContainer(idOrName).start();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 304) throw err;
    }
  }

  async stopContainer(idOrName: string, timeout = 10): Promise<void> {
    try {
      await this.docker.getContainer(idOrName).stop({ t: timeout });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 304) throw err;
    }
  }

  async removeContainer(idOrName: string, force = false): Promise<void> {
    try {
      await this.docker.getContainer(idOrName).remove({ force, v: true });
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

  async getContainerInfo(idOrName: string): Promise<ContainerInfo | null> {
    try {
      const data = await this.docker.getContainer(idOrName).inspect();
      return this.parseContainerInfo(data);
    } catch {
      return null;
    }
  }

  private parseContainerInfo(data: Dockerode.ContainerInspectInfo): ContainerInfo {
    const labels = data.Config?.Labels ?? {};
    const portBindings = data.HostConfig?.PortBindings ?? {};

    const ports: PortBinding[] = [];
    for (const [key, bindings] of Object.entries(portBindings)) {
      if (!bindings) continue;
      const [portStr, protocol] = key.split('/');
      for (const binding of bindings as Array<{ HostPort: string }>) {
        const hostPort = parseInt(binding.HostPort);
        const serviceLabel = labels[`${this.labelPrefix}.port.${hostPort}.service`];
        ports.push({
          container: parseInt(portStr),
          host: hostPort,
          protocol: protocol as 'tcp' | 'udp',
          service: serviceLabel,
        });
      }
    }

    let health: ContainerInfo['health'] = 'none';
    if (data.State?.Health) {
      const status = data.State.Health.Status;
      if (status === 'healthy') health = 'healthy';
      else if (status === 'unhealthy') health = 'unhealthy';
      else if (status === 'starting') health = 'starting';
    }

    const accessUrl = labels[`${this.labelPrefix}.access-url`];

    return {
      id: data.Id,
      name: data.Name.replace(/^\//, ''),
      state: data.State?.Status as ContainerState ?? 'created',
      status: data.State?.Status ?? 'unknown',
      image: data.Config?.Image ?? '',
      ports,
      health,
      accessUrl,
      labels,
    };
  }

  async listContainers(labelFilter?: Record<string, string>): Promise<ContainerInfo[]> {
    const filters: Record<string, string[]> = { label: [`${this.labelPrefix}=true`] };

    if (labelFilter) {
      for (const [k, v] of Object.entries(labelFilter)) {
        filters.label.push(`${k}=${v}`);
      }
    }

    const containers = await this.docker.listContainers({
      all: true,
      filters,
    });

    return containers.map((c: Dockerode.ContainerInfo) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') ?? '',
      state: c.State as ContainerState,
      status: c.Status,
      image: c.Image,
      ports: (c.Ports ?? []).map((p: Dockerode.Port) => ({
        container: p.PrivatePort,
        host: p.PublicPort ?? 0,
        protocol: p.Type as 'tcp' | 'udp',
      })),
      health: 'none' as const,
      labels: c.Labels ?? {},
    }));
  }

  async getContainerLogs(
    idOrName: string,
    options?: { tail?: number; since?: number; follow?: boolean },
  ): Promise<ReadableStream<Uint8Array>> {
    const container = this.docker.getContainer(idOrName);
    const follow = options?.follow ?? false;

    const logOptions = {
      stdout: true,
      stderr: true,
      tail: options?.tail ?? 100,
      since: options?.since,
    };

    const logStream = follow
      ? await container.logs({
        ...logOptions,
        follow: true as const,
      }) as unknown as NodeJS.ReadableStream
      : await container.logs({
        ...logOptions,
        follow: false as const,
      }) as unknown as NodeJS.ReadableStream;

    return new ReadableStream({
      start(controller) {
        logStream.on('data', (chunk: Uint8Array) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        logStream.on('end', () => controller.close());
        logStream.on('error', (err: Error) => controller.error(err));
      },
    });
  }

  async createNetwork(name: string, labels?: Record<string, string>): Promise<string> {
    const network = await this.docker.createNetwork({
      Name: name,
      Driver: 'bridge',
      Labels: {
        ...labels,
        [this.labelPrefix]: 'true',
      },
    });
    return network.id;
  }

  async removeNetwork(idOrName: string): Promise<void> {
    try {
      await this.docker.getNetwork(idOrName).remove();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

  async getNetworkInfo(idOrName: string): Promise<NetworkInfo | null> {
    try {
      const data = await this.docker.getNetwork(idOrName).inspect();
      return {
        id: data.Id ?? '',
        name: data.Name ?? '',
        driver: data.Driver ?? '',
        scope: data.Scope ?? '',
        containers: Object.keys(data.Containers ?? {}),
      };
    } catch {
      return null;
    }
  }

  async connectToNetwork(
    networkIdOrName: string,
    containerIdOrName: string,
    aliases?: string[],
  ): Promise<void> {
    await this.docker.getNetwork(networkIdOrName).connect({
      Container: containerIdOrName,
      EndpointConfig: aliases ? { Aliases: aliases } : undefined,
    });
  }

  async createVolume(name: string, labels?: Record<string, string>): Promise<string> {
    const volume = await this.docker.createVolume({
      Name: name,
      Labels: {
        ...labels,
        [this.labelPrefix]: 'true',
      },
    });
    return volume.Name;
  }

  async removeVolume(name: string): Promise<void> {
    try {
      await this.docker.getVolume(name).remove();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }

  async getVolumeInfo(name: string): Promise<VolumeInfo | null> {
    try {
      const data = await this.docker.getVolume(name).inspect();
      return {
        name: data.Name,
        driver: data.Driver,
        mountpoint: data.Mountpoint,
      };
    } catch {
      return null;
    }
  }

  async listVolumes(labelFilter?: Record<string, string>): Promise<VolumeInfo[]> {
    const filters: Record<string, string[]> = { label: [`${this.labelPrefix}=true`] };

    if (labelFilter) {
      for (const [k, v] of Object.entries(labelFilter)) {
        filters.label.push(`${k}=${v}`);
      }
    }

    const result = await this.docker.listVolumes({ filters });
    return (result.Volumes ?? []).map((v: Dockerode.VolumeInspectInfo) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
    }));
  }

  async execInContainer(
    idOrName: string,
    cmd: string[],
    options?: { workingDir?: string; env?: string[] },
  ): Promise<{ exitCode: number; output: string }> {
    const container = this.docker.getContainer(idOrName);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options?.workingDir,
      Env: options?.env,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const chunks: Uint8Array[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('end', async () => {
        try {
          const inspectData = await exec.inspect();
          const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          resolve({
            exitCode: inspectData.ExitCode ?? -1,
            output: new TextDecoder().decode(combined),
          });
        } catch (err) {
          reject(err);
        }
      });
      stream.on('error', reject);
    });
  }
}
