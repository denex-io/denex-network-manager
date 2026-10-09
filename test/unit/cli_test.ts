import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
import {
  ACCEPT_ANY,
  ACCEPT_LIVE,
  ACCEPT_RUNNING,
  buildPackageMatrix,
  colors,
  formatHealth,
  formatState,
  formatUptime,
  resolveInstanceId,
} from '../../src/cli/utils.ts';

Deno.test('colors.green - returns green text', () => {
  const result = colors.green('test');
  assertExists(result);
  assertStringIncludes(result, 'test');
});

Deno.test('colors.red - returns red text', () => {
  const result = colors.red('error');
  assertExists(result);
  assertStringIncludes(result, 'error');
});

Deno.test('formatState - running is green', () => {
  const result = formatState('running');
  assertStringIncludes(result, 'running');
});

Deno.test('formatState - starting is yellow', () => {
  const result = formatState('starting');
  assertStringIncludes(result, 'starting');
});

Deno.test('formatState - stopped is gray', () => {
  const result = formatState('stopped');
  assertStringIncludes(result, 'stopped');
});

Deno.test('formatState - error is red', () => {
  const result = formatState('error');
  assertStringIncludes(result, 'error');
});

Deno.test('formatState - unknown returns as-is', () => {
  const result = formatState('unknown');
  assertEquals(result, 'unknown');
});

Deno.test('formatHealth - healthy returns green bullet', () => {
  const result = formatHealth('healthy');
  assertStringIncludes(result, '●');
});

Deno.test('formatHealth - unhealthy returns red bullet', () => {
  const result = formatHealth('unhealthy');
  assertStringIncludes(result, '●');
});

Deno.test('formatHealth - undefined returns gray circle', () => {
  const result = formatHealth(undefined);
  assertStringIncludes(result, '○');
});

Deno.test('formatUptime - undefined returns dash', () => {
  const result = formatUptime(undefined);
  assertEquals(result, '-');
});

Deno.test('formatUptime - formats seconds', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 45000);
  const result = formatUptime(past);
  assertStringIncludes(result, 's');
});

Deno.test('formatUptime - formats minutes', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 5 * 60 * 1000);
  const result = formatUptime(past);
  assertStringIncludes(result, 'm');
});

Deno.test('formatUptime - formats hours', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const result = formatUptime(past);
  assertStringIncludes(result, 'h');
});

Deno.test('formatUptime - formats days', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const result = formatUptime(past);
  assertStringIncludes(result, 'd');
});

Deno.test('buildPackageMatrix - marks unreachable participants with ? and a header note', () => {
  const { header, rows } = buildPackageMatrix(['sv', 'validator-1'], new Set(['validator-1']), [
    { packageId: 'p1', validators: ['sv'] },
    { packageId: 'p2', validators: [] },
  ]);
  assertEquals(header, ['Package ID', 'sv', 'validator-1 (unreachable)']);
  assert(rows[0][1].includes('✓'));
  assertEquals(rows[0][2], '?');
  assertEquals(rows[1], ['p2', '', '?']);
});

const inst = (id: string, status: string) => ({ id, status });

Deno.test('resolveInstanceId - single running instance', () => {
  const r = resolveInstanceId([inst('a', 'running')], ['running']);
  assertEquals(r, { id: 'a', status: 'running', ignored: [] });
});

Deno.test('resolveInstanceId - running-only keeps the original error texts', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'stopped')], ['running']),
    Error,
    'No running LocalNet instances found. Start one with `dnm start`.',
  );
  assertThrows(
    () => resolveInstanceId([inst('a', 'running'), inst('b', 'running')], ['running']),
    Error,
    'Multiple running instances found (a, b). Specify with --instance <id>.',
  );
});

Deno.test('resolveInstanceId - running tier wins and others are reported as ignored', () => {
  const r = resolveInstanceId(
    [inst('a', 'stopped'), inst('b', 'running'), inst('c', 'mixed')],
    ['running', 'mixed', 'stopped'],
  );
  assertEquals(r.id, 'b');
  assertEquals(r.ignored, [inst('a', 'stopped'), inst('c', 'mixed')]);
});

Deno.test('resolveInstanceId - falls back to mixed, then stopped', () => {
  assertEquals(
    resolveInstanceId([inst('a', 'stopped'), inst('b', 'mixed')], ['running', 'mixed', 'stopped'])
      .id,
    'b',
  );
  const r = resolveInstanceId([inst('a', 'stopped')], ['running', 'mixed', 'stopped']);
  assertEquals(r.id, 'a');
  assertEquals(r.status, 'stopped');
});

Deno.test('resolveInstanceId - a stopped instance is not accepted by live commands', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'stopped')], ['running', 'mixed']),
    Error,
    'No running or mixed LocalNet instances found',
  );
});

Deno.test('resolveInstanceId - a sole mixed instance is accepted by live commands only', () => {
  const r = resolveInstanceId([inst('a', 'mixed')], ACCEPT_LIVE);
  assertEquals(r, { id: 'a', status: 'mixed', ignored: [] });
  assertThrows(
    () => resolveInstanceId([inst('a', 'mixed')], ACCEPT_RUNNING),
    Error,
    'No running LocalNet instances found',
  );
});

Deno.test('resolveInstanceId - ignored lists the others when a fallback tier is chosen', () => {
  const r = resolveInstanceId([inst('a', 'mixed'), inst('b', 'unsupported')], ACCEPT_ANY);
  assertEquals(r.id, 'a');
  assertEquals(r.ignored, [inst('b', 'unsupported')]);
});

Deno.test('resolveInstanceId - several stopped instances use plural "already stopped"', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'stopped'), inst('b', 'stopped')], ACCEPT_LIVE, true),
    Error,
    'LocalNets are already stopped (a, b)',
  );
});

Deno.test('resolveInstanceId - several instances in the deciding tier is an error', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'mixed'), inst('b', 'mixed')], ['running', 'mixed']),
    Error,
    'Multiple mixed instances found (a, b)',
  );
});

Deno.test('resolveInstanceId - unsupported instances are never chosen', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'unsupported')], ['running', 'mixed', 'stopped']),
    Error,
    'No LocalNet instances found',
  );
});

Deno.test('resolveInstanceId - stop reports "already stopped"', () => {
  assertThrows(
    () => resolveInstanceId([inst('a', 'stopped')], ['running', 'mixed'], true),
    Error,
    'LocalNet is already stopped (a)',
  );
});

Deno.test('resolveInstanceId - empty list with stopped accepted says no instances found', () => {
  assertThrows(
    () => resolveInstanceId([], ['running', 'mixed', 'stopped']),
    Error,
    'No LocalNet instances found. Start one with `dnm start`.',
  );
});

Deno.test('hidden --verbose is still accepted by parties, packages and entitlements', async () => {
  const { partiesCommand } = await import('../../src/cli/commands/parties.ts');
  const { packagesCommand } = await import('../../src/cli/commands/packages.ts');
  const { entitlementsCommand } = await import('../../src/cli/commands/entitlements.ts');
  for (const cmd of [partiesCommand, packagesCommand, entitlementsCommand]) {
    const option = cmd.getOption('verbose', true);
    assertExists(option);
    assertEquals(option.hidden, true);
  }
});
