import { createConnection } from 'node:net';
import type { HealthCheckConfig } from './types.ts';

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  duration: number;
}

export interface HealthCheckerOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<HealthCheckerOptions> = {
  timeout: 5000,
  retries: 30,
  retryDelay: 1000,
  backoffMultiplier: 1.5,
};

async function checkHttp(url: string, timeout: number): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - start;

    if (response.ok) {
      return { healthy: true, message: `HTTP ${response.status}`, duration };
    }
    return { healthy: false, message: `HTTP ${response.status}`, duration };
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { healthy: false, message, duration };
  }
}

function checkTcp(host: string, port: number, timeout: number): Promise<HealthCheckResult> {
  const start = Date.now();
  if (port < 0 || port >= 65536 || !Number.isInteger(port)) {
    return Promise.resolve({
      healthy: false,
      message: `Invalid port: ${port}`,
      duration: Date.now() - start,
    });
  }
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    const timer = setTimeout(() => {
      socket.destroy();
      const duration = Date.now() - start;
      resolve({ healthy: false, message: 'Connection timed out', duration });
    }, timeout);

    socket.on('connect', () => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      socket.destroy();
      resolve({ healthy: true, message: 'TCP connection successful', duration });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      resolve({ healthy: false, message: err.message, duration });
    });
  });
}

function checkGrpc(host: string, port: number, timeout: number): Promise<HealthCheckResult> {
  return checkTcp(host, port, timeout);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function checkHealth(
  config: HealthCheckConfig,
  options?: HealthCheckerOptions,
): Promise<HealthCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (config.type) {
    case 'http':
      return checkHttp(config.target, opts.timeout);

    case 'tcp': {
      const [host, portStr] = config.target.split(':');
      const port = parseInt(portStr, 10);
      return checkTcp(host, port, opts.timeout);
    }

    case 'grpc': {
      const [host, portStr] = config.target.split(':');
      const port = parseInt(portStr, 10);
      return checkGrpc(host, port, opts.timeout);
    }

    case 'exec':
      return Promise.resolve({
        healthy: false,
        message: 'Exec health checks not supported externally',
        duration: 0,
      });

    default:
      return Promise.resolve({
        healthy: false,
        message: `Unknown health check type: ${config.type}`,
        duration: 0,
      });
  }
}

export async function waitForHealthy(
  config: HealthCheckConfig,
  options?: HealthCheckerOptions,
): Promise<HealthCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastResult: HealthCheckResult = { healthy: false, message: 'Not checked', duration: 0 };
  let delay = opts.retryDelay;

  for (let attempt = 0; attempt < opts.retries; attempt++) {
    lastResult = await checkHealth(config, { timeout: opts.timeout });

    if (lastResult.healthy) {
      return lastResult;
    }

    if (attempt < opts.retries - 1) {
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, 10000);
    }
  }

  return lastResult;
}

export class HealthChecker {
  private checks: Map<string, HealthCheckConfig> = new Map();
  private options: Required<HealthCheckerOptions>;

  constructor(options?: HealthCheckerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  register(name: string, config: HealthCheckConfig): void {
    this.checks.set(name, config);
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  check(name: string): Promise<HealthCheckResult> {
    const config = this.checks.get(name);
    if (!config) {
      return Promise.resolve({
        healthy: false,
        message: `No health check registered for ${name}`,
        duration: 0,
      });
    }
    return checkHealth(config, this.options);
  }

  waitFor(name: string, options?: HealthCheckerOptions): Promise<HealthCheckResult> {
    const config = this.checks.get(name);
    if (!config) {
      return Promise.resolve({
        healthy: false,
        message: `No health check registered for ${name}`,
        duration: 0,
      });
    }
    return waitForHealthy(config, { ...this.options, ...options });
  }

  async checkAll(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    const promises = Array.from(this.checks.entries()).map(async ([name, config]) => {
      const result = await checkHealth(config, this.options);
      results.set(name, result);
    });
    await Promise.all(promises);
    return results;
  }

  async waitForAll(options?: HealthCheckerOptions): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    const opts = { ...this.options, ...options };

    const promises = Array.from(this.checks.entries()).map(async ([name, config]) => {
      const result = await waitForHealthy(config, opts);
      results.set(name, result);
    });

    await Promise.all(promises);
    return results;
  }

  allHealthy(results: Map<string, HealthCheckResult>): boolean {
    for (const result of results.values()) {
      if (!result.healthy) return false;
    }
    return true;
  }
}
