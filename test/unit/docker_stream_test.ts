import { assertEquals } from '@std/assert';
import { concatBytes, demuxDockerOutput, DockerStreamDemuxer } from '../../src/docker/stream.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function frame(type: 0 | 1 | 2 | 3, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(4, payload.length, false);
  out.set(payload, 8);
  return out;
}

function text(frames: { data: Uint8Array }[]): string {
  return dec.decode(concatBytes(frames.map((f) => f.data)));
}

Deno.test('demux - single frame in one chunk', () => {
  const d = new DockerStreamDemuxer();
  const frames = d.push(frame(1, enc.encode('hello\n')));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].stream, 'stdout');
  assertEquals(dec.decode(frames[0].data), 'hello\n');
  assertEquals(d.bufferedBytes, 0);
});

Deno.test('demux - input split at every byte boundary yields the same frames', () => {
  const input = concatBytes([
    frame(1, enc.encode('out one\n')),
    frame(2, enc.encode('err\n')),
    frame(1, enc.encode('out two\n')),
  ]);
  for (let cut = 0; cut <= input.length; cut++) {
    const d = new DockerStreamDemuxer();
    const frames = [...d.push(input.subarray(0, cut)), ...d.push(input.subarray(cut))];
    assertEquals(frames.map((f) => f.stream), ['stdout', 'stderr', 'stdout'], `cut=${cut}`);
    assertEquals(text(frames), 'out one\nerr\nout two\n', `cut=${cut}`);
    assertEquals(d.bufferedBytes, 0);
  }
});

Deno.test('demux - one byte at a time', () => {
  const input = concatBytes([frame(1, enc.encode('abc')), frame(2, enc.encode('def'))]);
  const d = new DockerStreamDemuxer();
  const frames = [];
  for (const b of input) frames.push(...d.push(new Uint8Array([b])));
  assertEquals(text(frames), 'abcdef');
  assertEquals(frames.map((f) => f.stream), ['stdout', 'stderr']);
});

Deno.test('demux - zero-length frames are emitted and consume only their header', () => {
  const d = new DockerStreamDemuxer();
  const frames = d.push(
    concatBytes([
      frame(1, new Uint8Array()),
      frame(2, enc.encode('x')),
      frame(1, new Uint8Array()),
    ]),
  );
  assertEquals(frames.length, 3);
  assertEquals(frames[0].data.length, 0);
  assertEquals(text(frames), 'x');
  assertEquals(d.bufferedBytes, 0);
});

Deno.test('demux - large payloads split across many chunks', () => {
  const payload = new Uint8Array(200 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  const input = frame(1, payload);
  const d = new DockerStreamDemuxer();
  const frames = [];
  for (let i = 0; i < input.length; i += 16 * 1024) {
    frames.push(...d.push(input.subarray(i, i + 16 * 1024)));
  }
  assertEquals(frames.length, 1);
  assertEquals(frames[0].data, payload);
  assertEquals(d.bufferedBytes, 0);
});

Deno.test('demux - interleaved stdout and stderr keep their order', () => {
  const d = new DockerStreamDemuxer();
  const frames = d.push(concatBytes([
    frame(1, enc.encode('1')),
    frame(2, enc.encode('2')),
    frame(1, enc.encode('3')),
    frame(2, enc.encode('4')),
  ]));
  assertEquals(text(frames), '1234');
  assertEquals(frames.map((f) => f.stream), ['stdout', 'stderr', 'stdout', 'stderr']);
});

Deno.test('demux - a trailing partial frame stays buffered', () => {
  const full = frame(1, enc.encode('complete'));
  const partial = frame(1, enc.encode('partial')).subarray(0, 12);
  const d = new DockerStreamDemuxer();
  const frames = d.push(concatBytes([full, partial]));
  assertEquals(text(frames), 'complete');
  assertEquals(d.bufferedBytes, 12);

  const dangling = demuxDockerOutput(concatBytes([full, new Uint8Array([1, 0, 0])]));
  assertEquals(dangling.frames.length, 1);
  assertEquals(dangling.leftoverBytes, 3);
});

Deno.test('demux - a UTF-8 character split across frames is intact after concatenation', () => {
  const bytes = enc.encode('héllo €');
  const mid = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
  const d = new DockerStreamDemuxer();
  const frames = d.push(
    concatBytes([frame(1, bytes.subarray(0, mid)), frame(1, bytes.subarray(mid))]),
  );
  assertEquals(frames.length, 2);
  assertEquals(text(frames), 'héllo €');
});

Deno.test('demux - stdin frames (type 0) are treated as stdout', () => {
  const frames = new DockerStreamDemuxer().push(frame(0, enc.encode('x')));
  assertEquals(frames[0].stream, 'stdout');
});

Deno.test('concatBytes - empty and multiple inputs', () => {
  assertEquals(concatBytes([]).length, 0);
  assertEquals(
    concatBytes([new Uint8Array([1]), new Uint8Array([2, 3])]),
    new Uint8Array([1, 2, 3]),
  );
});

Deno.test('demux - stream type 3 is a daemon message, reported as system', () => {
  const frames = new DockerStreamDemuxer().push(frame(3, enc.encode('Error grabbing logs: x')));
  assertEquals(frames.map((f) => f.stream), ['system']);
});
