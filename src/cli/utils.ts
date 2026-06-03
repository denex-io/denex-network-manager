import { Table } from '@cliffy/table';
import { LocalNet } from '../localnet.ts';
import type { ContainerInfo, ContainerState, LocalNetStatus } from '../docker/types.ts';

const isColorSupported = Deno.stdout.isTerminal();

function colorize(code: number, text: string): string {
  if (!isColorSupported) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const colors = {
  green: (s: string) => colorize(32, s),
  red: (s: string) => colorize(31, s),
  yellow: (s: string) => colorize(33, s),
  blue: (s: string) => colorize(34, s),
  cyan: (s: string) => colorize(36, s),
  gray: (s: string) => colorize(90, s),
  bold: (s: string) => colorize(1, s),
};

/**
 * Resolve a running LocalNet instance from labels (auto-discovers config).
 *
 * If `instanceId` is provided, attaches to that specific instance.
 * If omitted, requires exactly one running instance (errors otherwise).
 *
 * Used by state-2 commands that operate on a running LocalNet
 * (env, credentials, parties, packages, entitlements, stop, status, init).
 */
export async function getRunningLocalNet(instanceId?: string): Promise<LocalNet> {
  if (instanceId) {
    return await LocalNet.fromInstanceId(instanceId);
  }
  const instances = await LocalNet.discover();
  const running = instances.filter((i) => i.status === 'running');
  if (running.length === 0) {
    throw new Error(
      'No running LocalNet instances found. Start one with `denex-localnet start`.',
    );
  }
  if (running.length > 1) {
    const names = running.map((i) => i.id).join(', ');
    throw new Error(
      `Multiple running instances found (${names}). Specify with --instance <id>.`,
    );
  }
  return await LocalNet.fromInstanceId(running[0].id);
}

/**
 * Resolve a LocalNet instance for destruction, even if not fully running.
 *
 * Unlike getRunningLocalNet, allows attaching to instances in 'stopped' or
 * 'mixed' states so `destroy` can clean them up. Schema-1 ('unsupported')
 * instances cannot be attached and must be cleaned manually.
 */
export async function getDestroyableLocalNet(instanceId?: string): Promise<LocalNet> {
  if (instanceId) {
    return await LocalNet.fromInstanceId(instanceId);
  }
  const instances = await LocalNet.discover();
  const candidates = instances.filter((i) => i.status !== 'unsupported');
  if (candidates.length === 0) {
    throw new Error('No LocalNet instances found to destroy.');
  }
  if (candidates.length > 1) {
    const names = candidates.map((i) => i.id).join(', ');
    throw new Error(
      `Multiple instances found (${names}). Specify with --instance <id>.`,
    );
  }
  return await LocalNet.fromInstanceId(candidates[0].id);
}

export function formatState(state: string): string {
  switch (state) {
    case 'running':
      return colors.green(state);
    case 'starting':
    case 'stopping':
    case 'restarting':
      return colors.yellow(state);
    case 'stopped':
    case 'exited':
      return colors.gray(state);
    case 'error':
    case 'dead':
      return colors.red(state);
    default:
      return state;
  }
}

export function formatHealth(health?: string): string {
  switch (health) {
    case 'healthy':
      return colors.green('●');
    case 'unhealthy':
      return colors.red('●');
    case 'starting':
      return colors.yellow('○');
    default:
      return colors.gray('○');
  }
}

export function formatContainerState(state: ContainerState): string {
  return formatState(state);
}

export function formatUptime(startedAt?: Date): string {
  if (!startedAt) return '-';

  const diff = Date.now() - startedAt.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function renderStatusTable(status: LocalNetStatus): void {
  console.log();
  console.log(colors.bold('LocalNet Status'));
  console.log('─'.repeat(50));
  console.log(`State:    ${formatState(status.state)}`);
  console.log(`Uptime:   ${formatUptime(status.startedAt)}`);
  console.log(`Network:  ${status.network?.name ?? 'none'}`);
  console.log();

  if (status.containers.length === 0) {
    console.log(colors.gray('No containers'));
    return;
  }

  const table = new Table()
    .header(['', 'Container', 'State', 'Status', 'Ports'])
    .border(false);

  for (const c of status.containers) {
    let portsDisplay: string;
    if (c.accessUrl) {
      portsDisplay = c.accessUrl;
    } else if (c.ports.length > 0) {
      portsDisplay = c.ports.map((p) => {
        if (p.service) {
          return `${p.host} (${p.service})`;
        }
        return `${p.host}:${p.container}`;
      }).join(', ');
    } else {
      portsDisplay = '-';
    }
    table.push([
      formatHealth(c.health),
      c.name,
      formatContainerState(c.state),
      c.status,
      portsDisplay,
    ]);
  }

  table.render();
}

export function renderContainersTable(containers: ContainerInfo[]): void {
  if (containers.length === 0) {
    console.log(colors.gray('No containers'));
    return;
  }

  const table = new Table()
    .header(['', 'Container', 'State', 'Status', 'Image', 'Ports'])
    .border(false);

  for (const c of containers) {
    const ports = c.ports.map((p) => `${p.host}:${p.container}`).join(', ') || '-';
    const imageShort = c.image.split('/').pop() ?? c.image;
    table.push([
      formatHealth(c.health),
      c.name,
      formatContainerState(c.state),
      c.status,
      imageShort,
      ports,
    ]);
  }

  table.render();
}

export function printSuccess(message: string): void {
  console.log(colors.green('✓'), message);
}

export function printError(message: string): void {
  console.error(colors.red('✗'), message);
}

export function printWarning(message: string): void {
  console.log(colors.yellow('!'), message);
}

export function printInfo(message: string): void {
  console.log(colors.blue('ℹ'), message);
}

export function progress(message: string): { stop: () => void; update: (msg: string) => void } {
  let lastMessage = '';
  console.log(message);
  return {
    stop: () => {},
    update: (msg: string) => {
      if (msg !== lastMessage) {
        console.log(msg);
        lastMessage = msg;
      }
    },
  };
}
