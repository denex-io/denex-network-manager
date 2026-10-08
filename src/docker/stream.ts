/**
 * Demultiplexing of Docker's attach/logs/exec stream framing.
 *
 * Containers started without a TTY multiplex stdout and stderr over one byte
 * stream. Each frame is an 8-byte header followed by the payload:
 * `[streamType, 0, 0, 0, size (uint32 big-endian)]`. Stream type 0 is stdin,
 * 1 is stdout and 2 is stderr.
 *
 * Internal helpers: not part of the public API. Uses only `Uint8Array` and
 * `DataView`, so it is safe in every supported runtime.
 */

const HEADER_BYTES = 8;

/** One decoded frame of a multiplexed Docker stream. */
export interface DockerStreamFrame {
  /** Which stream the payload belongs to. Stream type 0 (stdin) maps to stdout. */
  stream: 'stdout' | 'stderr';
  data: Uint8Array;
}

/** Concatenates byte arrays into one new array. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Incremental demultiplexer. Feed it arbitrarily split chunks with
 * {@link DockerStreamDemuxer.push}; it returns every frame completed by that
 * chunk. Incomplete trailing data stays buffered (see `bufferedBytes`).
 */
export class DockerStreamDemuxer {
  private chunks: Uint8Array[] = [];
  private length = 0;

  /** Bytes received but not yet emitted as part of a complete frame. */
  get bufferedBytes(): number {
    return this.length;
  }

  push(chunk: Uint8Array): DockerStreamFrame[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
    const frames: DockerStreamFrame[] = [];
    while (this.length >= HEADER_BYTES) {
      const header = this.peek(HEADER_BYTES);
      const size = new DataView(header.buffer, header.byteOffset, header.byteLength)
        .getUint32(4, false);
      if (this.length < HEADER_BYTES + size) break;
      this.discard(HEADER_BYTES);
      frames.push({
        stream: header[0] === 2 ? 'stderr' : 'stdout',
        data: this.take(size),
      });
    }
    return frames;
  }

  /** Copies the first `n` buffered bytes without consuming them. */
  private peek(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    for (const chunk of this.chunks) {
      if (filled === n) break;
      const part = chunk.subarray(0, n - filled);
      out.set(part, filled);
      filled += part.length;
    }
    return out;
  }

  private discard(n: number): void {
    this.take(n);
  }

  /** Removes and returns the first `n` buffered bytes. */
  private take(n: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let remaining = n;
    while (remaining > 0) {
      const head = this.chunks[0];
      if (head.length <= remaining) {
        parts.push(head);
        remaining -= head.length;
        this.chunks.shift();
      } else {
        parts.push(head.subarray(0, remaining));
        this.chunks[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    this.length -= n;
    return parts.length === 1 ? parts[0].slice() : concatBytes(parts);
  }
}

/**
 * Demultiplexes a complete buffer. Returns the frames and the number of
 * trailing bytes that did not form a complete frame.
 */
export function demuxDockerOutput(
  data: Uint8Array,
): { frames: DockerStreamFrame[]; leftoverBytes: number } {
  const demuxer = new DockerStreamDemuxer();
  const frames = demuxer.push(data);
  return { frames, leftoverBytes: demuxer.bufferedBytes };
}
