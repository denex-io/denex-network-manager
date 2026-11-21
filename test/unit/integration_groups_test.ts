import { assertEquals } from '@std/assert';
import { GROUPS } from '../integration/groups.ts';

// Each group runs as its own job (test/integration/run_group.ts). A test file in no group would
// silently never run; one in two groups would run twice.
Deno.test('integration groups - every integration test file is in exactly one group', async () => {
  const onDisk: string[] = [];
  for await (const entry of Deno.readDir(new URL('../integration/', import.meta.url))) {
    if (entry.isFile && entry.name.endsWith('_test.ts')) onDisk.push(entry.name);
  }
  const listed = Object.values(GROUPS).flatMap((group) => group.files);
  assertEquals(listed.sort(), onDisk.sort());
});
