/**
 * What the scripts and both vitest setups share: where things are, which LocalNet instance this
 * project uses, and how to run a command and fail loudly when it fails.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The instance id namespaces every container, network and volume of the LocalNet. To run a second
 * copy on the same Docker daemon, give it its own id here and its own LOCALNET_BASE_PORT (see
 * localnet.yaml).
 */
export const INSTANCE = process.env.LOCALNET_INSTANCE ?? 'rsvp-tests';

export const CONFIG = join(ROOT, 'localnet.yaml');
/** Written by `npm run build:dar`; localnet.yaml's `packages:` entry points here too. */
export const DAR = join(ROOT, 'daml/.daml/dist/rsvp.dar');
export const LOGS_DIR = join(ROOT, 'logs');

/** The validators hosting the app's parties, so the participants that need the DAR. */
export const APP_VALIDATORS = ['org-a', 'org-b'];

/** The dnm CLI that scripts/install-dnm.sh installs at the version pinned in package.json. */
export const DNM = join(ROOT, '.dnm/bin/dnm');

/** Runs a command with its output on the console; resolves with its exit code. */
export function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Runs a command and returns its stdout; its stderr goes to the console. Throws on failure. */
export function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

/** Runs `dnm`, failing loudly on a non-zero exit. */
export async function dnm(...args: string[]): Promise<void> {
  const code = await run(DNM, args);
  if (code !== 0) throw new Error(`dnm ${args.join(' ')} exited with ${code}`);
}

/** Runs `dnm ... --json` and parses what it prints. */
export async function dnmJson<T>(...args: string[]): Promise<T> {
  return JSON.parse(await output(DNM, [...args, '--json'])) as T;
}
