/**
 * Copies the logs of the LocalNet's containers into logs/ while they run.
 *
 * A workaround, not part of the recommended setup: dnm 0.1.0-beta.3 removes the containers of a
 * failed first start, and its error carries no container logs, so logs collected after a failure
 * find nothing. Following them from the start covers that until dnm keeps them itself.
 */
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { INSTANCE, LOGS_DIR } from './dnm.ts';

const exec = promisify(execFile);

/** Starts following every container of the instance, including ones created later. */
export function followContainerLogs(): { stop(): Promise<void> } {
  rmSync(LOGS_DIR, { recursive: true, force: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  const followed = new Map<string, ChildProcess>();
  const closed: Promise<void>[] = [];
  let stopped = false;

  const poll = async () => {
    const { stdout } = await exec('docker', [
      'ps',
      '--all',
      '--filter',
      `label=denex.localnet.instance=${INSTANCE}`,
      '--format',
      '{{.ID}} {{.Names}}',
    ]);
    for (const line of stdout.split('\n').filter(Boolean)) {
      const [id, name] = line.split(' ');
      // A poll still running when stop() is called must not start new followers: on a LocalNet
      // that stays up they would never exit, and neither would this process.
      if (stopped || followed.has(id)) continue;
      const file = createWriteStream(join(LOGS_DIR, `${name}.log`), { flags: 'a' });
      const child = spawn('docker', ['logs', '--follow', '--timestamps', id]);
      // Two sources share the file, so neither may end it; close it when the follower exits.
      child.stdout.pipe(file, { end: false });
      child.stderr.pipe(file, { end: false });
      child.on('close', () => file.end());
      closed.push(new Promise((resolve) => file.on('close', () => resolve())));
      followed.set(id, child);
    }
  };
  const tick = () => poll().catch((error) => console.warn(`container-logs: ${error}`));
  void tick();
  const timer = setInterval(tick, 2000);

  return {
    /** Stops following; resolves once every log file is written and closed. */
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const child of followed.values()) child.kill();
      await Promise.all(closed);
    },
  };
}

/** Prints the end of each container's log, for a failed run. */
export function printLogTails(lines = 40): void {
  const files = readdirSync(LOGS_DIR).filter((f) => f.endsWith('.log')).sort();
  for (const file of files) {
    const tail = readFileSync(join(LOGS_DIR, file), 'utf8').trimEnd().split('\n').slice(-lines);
    console.error(`\n--- ${file} (last ${tail.length} lines) ---\n${tail.join('\n')}`);
  }
  console.error(`\nFull container logs: ${LOGS_DIR}`);
}
