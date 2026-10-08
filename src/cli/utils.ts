import { Table } from '@cliffy/table';
import { LocalNet, type LocalNetOptions } from '../localnet.ts';
import type { LocalNetWarning } from '../types/state.ts';
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

/** Instance statuses a command can act on. */
export type ResolvableStatus = 'running' | 'mixed' | 'stopped';

/** Tier order used when auto-resolving: running first, then mixed, then stopped. */
const TIER_ORDER: readonly ResolvableStatus[] = ['running', 'mixed', 'stopped'];

/** Accept set for the read-only commands (status, env, credentials). */
export const ACCEPT_ANY: readonly ResolvableStatus[] = ['running', 'mixed', 'stopped'];
/** Accept set for commands that need at least one live container (stop, parties, ...). */
export const ACCEPT_LIVE: readonly ResolvableStatus[] = ['running', 'mixed'];
/** Accept set for commands that need a fully running instance (init). */
export const ACCEPT_RUNNING: readonly ResolvableStatus[] = ['running'];

/**
 * Pick the instance a command acts on when `--instance` is omitted.
 *
 * Walks the tiers running, then mixed, then stopped (restricted to `accept`). The first tier
 * with any candidate decides: exactly one candidate is chosen, several are an error. `ignored`
 * lists every other discovered instance, so callers can tell the user what was passed over.
 *
 * @param reportStopped - when nothing is acceptable but stopped instances exist, say they are
 *   already stopped instead of "not found" (used by `stop`)
 */
export function resolveInstanceId(
  instances: ReadonlyArray<{ id: string; status: string }>,
  accept: readonly ResolvableStatus[],
  reportStopped = false,
): { id: string; status: ResolvableStatus; ignored: { id: string; status: string }[] } {
  const tiers = TIER_ORDER.filter((t) => accept.includes(t));
  for (const tier of tiers) {
    const candidates = instances.filter((i) => i.status === tier);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      const names = candidates.map((i) => i.id).join(', ');
      throw new Error(
        `Multiple ${tier} instances found (${names}). Specify with --instance <id>.`,
      );
    }
    const chosen = candidates[0];
    return {
      id: chosen.id,
      status: tier,
      ignored: instances.filter((i) => i.id !== chosen.id).map((i) => ({
        id: i.id,
        status: i.status,
      })),
    };
  }
  if (reportStopped) {
    const stopped = instances.filter((i) => i.status === 'stopped');
    if (stopped.length > 0) {
      throw new Error(
        `LocalNet is already stopped (${stopped.map((i) => i.id).join(', ')}).`,
      );
    }
  }
  if (accept.includes('stopped')) {
    throw new Error('No LocalNet instances found. Start one with `dnm start`.');
  }
  const label = accept.length === 1 ? accept[0] : accept.join(' or ');
  throw new Error(`No ${label} LocalNet instances found. Start one with \`dnm start\`.`);
}

/**
 * Resolve a LocalNet instance from labels (auto-discovers config).
 *
 * If `instanceId` is provided, attaches to that specific instance. If omitted, resolves one
 * with {@link resolveInstanceId} using `accept`, and prints a stderr notice when a fallback
 * tier was used or other instances were ignored.
 *
 * Used by commands that operate on an existing LocalNet
 * (env, credentials, parties, packages, entitlements, stop, status, init).
 */
export async function getRunningLocalNet(
  instanceId?: string,
  options?: LocalNetOptions,
  accept: readonly ResolvableStatus[] = ACCEPT_RUNNING,
  reportStopped = false,
): Promise<LocalNet> {
  if (instanceId) {
    return await LocalNet.fromInstanceId(instanceId, options);
  }
  const instances = await LocalNet.discover();
  const { id, status, ignored } = resolveInstanceId(instances, accept, reportStopped);
  if (status !== 'running') {
    console.error(colors.yellow('Note:'), `using ${status} instance "${id}".`);
  }
  if (ignored.length > 0) {
    const list = ignored.map((i) => `${i.id} (${i.status})`).join(', ');
    console.error(
      colors.yellow('Note:'),
      `ignoring other instances: ${list}. Use --instance <id> to pick one.`,
    );
  }
  return await LocalNet.fromInstanceId(id, options);
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

/**
 * `onWarning` handler for query commands: prints to stderr so `--json` output on stdout
 * stays clean.
 */
export function warnToStderr(warning: LocalNetWarning): void {
  console.error(colors.yellow('Warning:'), warning.message);
}

/**
 * Header and rows for the `dnm packages` matrix. A participant in `unreachable` gets an
 * `(unreachable)` header and `?` in every row instead of a (misleading) blank.
 */
export function buildPackageMatrix(
  participants: string[],
  unreachable: ReadonlySet<string>,
  packages: ReadonlyArray<{ packageId: string; validators: string[] }>,
): { header: string[]; rows: string[][] } {
  return {
    header: [
      'Package ID',
      ...participants.map((p) => unreachable.has(p) ? `${p} (unreachable)` : p),
    ],
    rows: packages.map((pkg) => [
      pkg.packageId,
      ...participants.map((p) =>
        unreachable.has(p) ? '?' : pkg.validators.includes(p) ? colors.green('✓') : ''
      ),
    ]),
  };
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
