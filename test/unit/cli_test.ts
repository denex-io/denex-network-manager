import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { colors, formatHealth, formatState, formatUptime } from '../../src/cli/utils.ts';

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
