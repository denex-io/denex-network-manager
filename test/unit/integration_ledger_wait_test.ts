import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { JsonApiNotReadyError, waitForLedgerJsonApi } from '../integration/helpers.ts';

function serve(status: () => number): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    () => new Response(null, { status: status() }),
  );
}

Deno.test('waitForLedgerJsonApi - an API that never answers 2xx fails typed, within the bound', async () => {
  const server = serve(() => 503);
  try {
    const url = `http://127.0.0.1:${server.addr.port}`;
    const started = Date.now();
    const error = await assertRejects(() => waitForLedgerJsonApi(url, 500), JsonApiNotReadyError);
    assert(Date.now() - started < 1500, `took ${Date.now() - started} ms for a 500 ms bound`);
    assertEquals(error.url, `${url}/livez`);
    assertStringIncludes(String(error.cause), 'HTTP 503');
  } finally {
    await server.shutdown();
  }
});

Deno.test('waitForLedgerJsonApi - returns once /livez answers 2xx', async () => {
  let calls = 0;
  const server = serve(() => ++calls < 3 ? 503 : 200);
  try {
    await waitForLedgerJsonApi(`http://127.0.0.1:${server.addr.port}`, 5_000);
    assertEquals(calls, 3);
  } finally {
    await server.shutdown();
  }
});
