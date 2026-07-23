export interface PortBinding {
  container: number;
  host?: number;
  protocol?: 'tcp' | 'udp';
  service?: string;
}

export interface VolumeMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface HealthCheckConfig {
  type: 'http' | 'tcp' | 'grpc' | 'exec';
  target: string;
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

export interface ContainerSpec {
  name: string;
  image: string;
  environment?: Record<string, string>;
  ports?: PortBinding[];
  volumes?: VolumeMount[];
  networks?: string[];
  healthCheck?: HealthCheckConfig;
  dependsOn?: string[];
  command?: string[];
  entrypoint?: string[];
  workingDir?: string;
  hostname?: string;
  memoryLimit?: number;
  cpuLimit?: number;
  labels?: Record<string, string>;
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
}

export type ContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead';

export interface ContainerInfo {
  id: string;
  name: string;
  state: ContainerState;
  status: string;
  image: string;
  ports: PortBinding[];
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  accessUrl?: string;
  labels: Record<string, string>;
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  containers: string[];
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
}

export type LocalNetState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface LocalNetStatus {
  state: LocalNetState;
  containers: ContainerInfo[];
  network?: NetworkInfo;
  startedAt?: Date;
  error?: string;
}

export interface StartOptions {
  timeout?: number;
  parallel?: boolean;
  skipHealthChecks?: boolean;
  skipInitialization?: boolean;
  onProgress?: (message: string) => void;
}

export interface StopOptions {
  /** Grace period in **milliseconds** before containers are force-killed. Defaults to 30_000. */
  timeout?: number;
  removeVolumes?: boolean;
}
