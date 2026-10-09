import Dockerode from 'dockerode';
import type { Readable } from 'node:stream';
import { concatBytes, demuxDockerOutput, DockerStreamDemuxer } from './stream.ts';
import type {
  ContainerInfo,
  ContainerSpec,
  ContainerState,
  ExecResult,
  NetworkInfo,
  PortBinding,
  VolumeInfo,
} from './types.ts';

export interface DockerClientOptions {
  labelPrefix?: string;
  dockerOptions?: Dockerode.DockerOptions;
}

const DEFAULT_LABEL_PREFIX = 'denex.localnet';
const EXEC_INSPECT_RETRIES = 20;
const EXEC_INSPECT_DELAY_MS = 100;

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

  /**
   * Stop a container. `timeout` is the grace period in **seconds** before the
   * daemon escalates to SIGKILL (Docker's `t` query param). Docker parses `t`
   * with an integer-only parser, so a fractional value (e.g. `0.03`) is
   * rejected with `strconv.Atoi ... invalid syntax` (HTTP 500). Coerce to a
   * non-negative integer so a bad caller can never produce that error.
   */
  async stopContainer(idOrName: string, timeout = 10): Promise<void> {
    const t = Math.max(0, Math.round(timeout));
    try {
      await this.docker.getContainer(idOrName).stop({ t });
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

  /**
   * Reads a container's logs as raw bytes with Docker's stream framing removed.
   *
   * stdout and stderr are merged in arrival order. Containers started without
   * a TTY (all of this SDK's containers) multiplex both streams with 8-byte
   * frame headers; those are stripped. Containers with a TTY are passed through
   * unchanged.
   *
   * With `follow: false` (default) the stream yields the last `tail` lines
   * (default 100) and closes. With `follow: true` it stays open until the
   * container stops or the stream is cancelled; cancelling destroys the
   * underlying connection.
   */
  async getContainerLogs(
    idOrName: string,
    options?: { tail?: number; since?: number; follow?: boolean },
  ): Promise<ReadableStream<Uint8Array>> {
    const container = this.docker.getContainer(idOrName);
    const follow = options?.follow ?? false;
    const info = await container.inspect();
    const tty = info.Config?.Tty === true;

    const logOptions = {
      stdout: true,
      stderr: true,
      tail: options?.tail ?? 100,
      since: options?.since,
    };

    if (!follow) {
      // Without `follow`, docker-modem resolves with the whole body: a Buffer,
      // or the parsed value when the body happens to be valid JSON.
      const result: unknown = await container.logs({ ...logOptions, follow: false as const });
      const body = logsResultToBytes(result);
      let bytes: Uint8Array = body;
      if (!tty) {
        const demuxed = demuxDockerOutput(body);
        if (demuxed.leftoverBytes > 0) {
          throw new Error(
            `Log output was truncated: ${demuxed.leftoverBytes} trailing bytes ` +
              `did not form a complete frame`,
          );
        }
        for (const f of demuxed.frames) {
          if (f.stream === 'system') throw daemonStreamError(f.data);
        }
        bytes = concatBytes(demuxed.frames.map((f) => f.data));
      }
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytes.length > 0) controller.enqueue(bytes);
          controller.close();
        },
      });
    }

    // The runtime object is an http.IncomingMessage, which is a Readable.
    const logStream = await container.logs({
      ...logOptions,
      follow: true as const,
    }) as unknown as Readable;
    const demuxer = tty ? null : new DockerStreamDemuxer();
    let settled = false;
    let ended = false;

    return new ReadableStream<Uint8Array>({
      start(controller) {
        logStream.on('data', (chunk: Uint8Array) => {
          if (settled) return;
          const bytes = new Uint8Array(chunk);
          if (demuxer) {
            for (const frame of demuxer.push(bytes)) {
              if (frame.stream === 'system') {
                settled = true;
                controller.error(daemonStreamError(frame.data));
                logStream.destroy();
                return;
              }
              if (frame.data.length > 0) controller.enqueue(frame.data);
            }
          } else {
            controller.enqueue(bytes);
          }
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            logStream.pause();
          }
        });
        logStream.on('end', () => {
          if (settled) return;
          ended = true;
          settled = true;
          if (demuxer && demuxer.bufferedBytes > 0) {
            controller.error(
              new Error(
                `Log stream truncated: ${demuxer.bufferedBytes} trailing bytes ` +
                  `did not form a complete frame`,
              ),
            );
            return;
          }
          controller.close();
        });
        logStream.on('error', (err: Error) => {
          if (settled) return;
          settled = true;
          controller.error(err);
        });
        logStream.on('close', () => {
          if (settled) return;
          settled = true;
          if (!ended) {
            controller.error(new Error('Log stream truncated: connection closed before end'));
            return;
          }
          controller.close();
        });
      },
      pull() {
        logStream.resume();
      },
      cancel() {
        settled = true;
        logStream.destroy();
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

  /**
   * Runs a command in a running container and waits for it to finish.
   *
   * The exec is created without a TTY, so Docker multiplexes stdout and stderr;
   * the framing is removed. `output` is stdout and stderr merged in arrival
   * order. Rejects if the stream ends in the middle of a frame (truncated
   * output) or the connection errors.
   */
  async execInContainer(
    idOrName: string,
    cmd: string[],
    options?: { workingDir?: string; env?: string[] },
  ): Promise<ExecResult> {
    const container = this.docker.getContainer(idOrName);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: options?.workingDir,
      Env: options?.env,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const demuxer = new DockerStreamDemuxer();
    const combined: Uint8Array[] = [];
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];

    return new Promise<ExecResult>((resolve, reject) => {
      let settled = false;
      const finish = async (streamError?: Error) => {
        if (settled) return;
        settled = true;
        if (streamError) {
          stream.destroy();
          reject(streamError);
          return;
        }
        try {
          if (demuxer.bufferedBytes > 0) {
            throw new Error(
              `Exec output was truncated: ${demuxer.bufferedBytes} trailing bytes ` +
                `did not form a complete frame`,
            );
          }
          const exitCode = await this.waitForExecExit(exec);
          const decoder = new TextDecoder();
          resolve({
            exitCode,
            output: decoder.decode(concatBytes(combined)),
            stdout: decoder.decode(concatBytes(stdout)),
            stderr: decoder.decode(concatBytes(stderr)),
          });
        } catch (err) {
          stream.destroy();
          reject(err);
        }
      };

      stream.on('data', (chunk: Uint8Array) => {
        for (const frame of demuxer.push(new Uint8Array(chunk))) {
          combined.push(frame.data);
          (frame.stream === 'stderr' ? stderr : stdout).push(frame.data);
        }
      });
      stream.on('end', () => void finish());
      stream.on('close', () => void finish());
      stream.on('error', (err: Error) => void finish(err));
    });
  }

  /**
   * Inspects an exec until it has finished. The stream can end a moment before
   * the daemon records the exit code, so retry briefly while it is still
   * running or the code is missing. Returns -1 if no exit code ever appears.
   */
  private async waitForExecExit(exec: Dockerode.Exec): Promise<number> {
    let inspectData = await exec.inspect();
    for (
      let attempt = 0;
      attempt < EXEC_INSPECT_RETRIES &&
      (inspectData.Running === true || inspectData.ExitCode == null);
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, EXEC_INSPECT_DELAY_MS));
      inspectData = await exec.inspect();
    }
    return inspectData.ExitCode ?? -1;
  }
}

/** The error Docker's own `StdCopy` raises for a daemon-side (type 3) frame. */
function daemonStreamError(payload: Uint8Array): Error {
  return new Error(`error from daemon in stream: ${new TextDecoder().decode(payload).trim()}`);
}

/** Normalizes the non-streaming `logs()` result to bytes. */
function logsResultToBytes(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) return new Uint8Array(result);
  if (typeof result === 'string') return new TextEncoder().encode(result);
  // docker-modem JSON-parses bodies that happen to be valid JSON (for example
  // TTY output that is just a number). Such bodies are re-serialized, so
  // quotes and whitespace of a JSON-looking TTY body can differ from the raw
  // bytes. Only TTY containers are affected; the SDK starts none.
  return new TextEncoder().encode(JSON.stringify(result));
}
