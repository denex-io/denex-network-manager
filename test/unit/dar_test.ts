import { assertEquals, assertThrows } from '@std/assert';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readDarMainPackageId } from '../../src/api/dar.ts';

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function varint(n: number): Uint8Array {
  const bytes: number[] = [];
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
  return Uint8Array.from(bytes);
}

function lengthField(field: number, value: Uint8Array): Uint8Array {
  return concat(varint(field * 8 + 2), varint(value.length), value);
}

const PAYLOAD = encoder.encode('not a real daml-lf payload');
const PAYLOAD_HASH = createHash('sha256').update(PAYLOAD).digest('hex');

interface DalfOptions {
  hash?: string | null;
  payload?: Uint8Array | null;
}

function buildDalf(options: DalfOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [concat(varint(1 * 8 + 0), varint(0))]; // hash_function = SHA256
  if (options.payload !== null) parts.push(lengthField(3, options.payload ?? PAYLOAD));
  if (options.hash !== null) {
    parts.push(lengthField(4, encoder.encode(options.hash ?? PAYLOAD_HASH)));
  }
  return concat(...parts);
}

interface ZipFile {
  name: string;
  data: Uint8Array;
  method?: number;
  flags?: number;
  sizeOverride?: number;
}

function u16(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function buildZip(files: ZipFile[], eocdSizeOverride?: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const method = file.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const name = encoder.encode(file.name);
    const size = file.sizeOverride ?? body.length;
    // Sizes live in the central directory only (as with data-descriptor entries).
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16((file.flags ?? 0) | 0x8),
      u16(method),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u16(name.length),
      u16(0),
      name,
      body,
    );
    central.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16((file.flags ?? 0) | 0x8),
        u16(method),
        u32(0),
        u32(0),
        u32(size),
        u32(file.sizeOverride ?? file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    );
    chunks.push(local);
    offset += local.length;
  }
  const directory = concat(...central);
  return concat(
    ...chunks,
    directory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(eocdSizeOverride ?? files.length),
    u16(eocdSizeOverride ?? files.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  );
}

function manifest(mainDalf: string, eol = '\n'): Uint8Array {
  const lines = ['Manifest-Version: 1.0', 'Created-By: test'];
  const header = `Main-Dalf: ${mainDalf}`;
  // Fold at 72 columns like jar manifests do.
  lines.push(header.slice(0, 72));
  for (let i = 72; i < header.length; i += 71) lines.push(' ' + header.slice(i, i + 71));
  lines.push('Dalfs: x.dalf', '');
  return encoder.encode(lines.join(eol));
}

const DALF_NAME = 'pkg-1.0.0/pkg.dalf';

function standardDar(method = 8, dalf: Uint8Array = buildDalf()): Uint8Array {
  return buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME), method },
    { name: DALF_NAME, data: dalf, method },
  ]);
}

Deno.test('readDarMainPackageId - deflated entries (data-descriptor layout)', () => {
  assertEquals(readDarMainPackageId(standardDar(8)), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - stored entries', () => {
  assertEquals(readDarMainPackageId(standardDar(0)), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - unfolds a manifest folded at 72 columns', () => {
  const longName = 'a-very-long-package-name-3.3.0-' + 'b'.repeat(64) + '/' + 'c'.repeat(60) +
    '.dalf';
  const bytes = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(longName) },
    { name: longName, data: buildDalf() },
  ]);
  assertEquals(readDarMainPackageId(bytes), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - tolerates CRLF and trailing CR in the manifest', () => {
  const bytes = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME, '\r\n') },
    { name: DALF_NAME, data: buildDalf() },
  ]);
  assertEquals(readDarMainPackageId(bytes), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - field 1 absent is fine', () => {
  const dalf = concat(lengthField(3, PAYLOAD), lengthField(4, encoder.encode(PAYLOAD_HASH)));
  assertEquals(readDarMainPackageId(standardDar(8, dalf)), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - field 4 absent falls back to sha256 of field 3', () => {
  assertEquals(readDarMainPackageId(standardDar(8, buildDalf({ hash: null }))), PAYLOAD_HASH);
});

Deno.test('readDarMainPackageId - prefers the stored hash (field 4)', () => {
  const hash = 'ab'.repeat(32);
  assertEquals(readDarMainPackageId(standardDar(8, buildDalf({ hash }))), hash);
});

Deno.test('readDarMainPackageId - rejects a malformed hash', () => {
  assertThrows(
    () => readDarMainPackageId(standardDar(8, buildDalf({ hash: 'NOT-HEX' }))),
    Error,
    'Invalid DAR:',
  );
});

Deno.test('readDarMainPackageId - rejects a DALF with neither hash nor payload', () => {
  assertThrows(
    () => readDarMainPackageId(standardDar(8, buildDalf({ hash: null, payload: null }))),
    Error,
    'Invalid DAR:',
  );
});

Deno.test('readDarMainPackageId - rejects non-zip input', () => {
  assertThrows(
    () => readDarMainPackageId(encoder.encode('definitely not a zip file at all')),
    Error,
    'Invalid DAR: not a zip archive',
  );
  assertThrows(() => readDarMainPackageId(new Uint8Array(0)), Error, 'Invalid DAR:');
});

Deno.test('readDarMainPackageId - rejects a missing manifest', () => {
  const bytes = buildZip([{ name: DALF_NAME, data: buildDalf() }]);
  assertThrows(() => readDarMainPackageId(bytes), Error, 'MANIFEST.MF not found');
});

Deno.test('readDarMainPackageId - rejects a manifest without Main-Dalf', () => {
  const bytes = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: encoder.encode('Manifest-Version: 1.0\n') },
  ]);
  assertThrows(() => readDarMainPackageId(bytes), Error, 'no Main-Dalf');
});

Deno.test('readDarMainPackageId - rejects a missing Main-Dalf entry', () => {
  const bytes = buildZip([{ name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME) }]);
  assertThrows(() => readDarMainPackageId(bytes), Error, 'not found in the archive');
});

Deno.test('readDarMainPackageId - rejects ZIP64 sentinel sizes', () => {
  const entry = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME), sizeOverride: 0xffffffff },
    { name: DALF_NAME, data: buildDalf() },
  ]);
  assertThrows(() => readDarMainPackageId(entry), Error, 'ZIP64');

  const eocd = buildZip(
    [
      { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME) },
      { name: DALF_NAME, data: buildDalf() },
    ],
    0xffff,
  );
  assertThrows(() => readDarMainPackageId(eocd), Error, 'ZIP64');
});

Deno.test('readDarMainPackageId - rejects encrypted entries', () => {
  const bytes = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME) },
    { name: DALF_NAME, data: buildDalf(), flags: 0x1 },
  ]);
  assertThrows(() => readDarMainPackageId(bytes), Error, 'encrypted');
});

Deno.test('readDarMainPackageId - rejects unsupported compression methods', () => {
  const bytes = buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifest(DALF_NAME) },
    { name: DALF_NAME, data: buildDalf(), method: 12 },
  ]);
  assertThrows(() => readDarMainPackageId(bytes), Error, 'unsupported compression method 12');
});
