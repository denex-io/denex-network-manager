/**
 * Minimal DAR reader: computes the main package ID of a DAR without any
 * dependency beyond `node:zlib` and `node:crypto`.
 *
 * Canton's `POST /v2/dars` returns an empty body, so the package ID has to be
 * derived client-side. A DAR is a zip archive whose `META-INF/MANIFEST.MF`
 * names the main DALF in its `Main-Dalf` entry. A DALF is a protobuf
 * `Archive` message: field 3 is the payload and field 4 is the package ID
 * (the hex SHA-256 of the payload).
 *
 * @module api/dar
 */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const PACKAGE_ID_PATTERN = /^[0-9a-f]{64}$/;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function invalid(reason: string): Error {
  return new Error(`Invalid DAR: ${reason}`);
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  const lowest = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= lowest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid('not a zip archive (no end-of-central-directory record)');

  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw invalid('ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > bytes.length) {
    throw invalid('central directory is out of bounds');
  }

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let pos = directoryOffset;
  for (let n = 0; n < entryCount; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
      throw invalid('corrupt central directory');
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw invalid(`ZIP64 entry '${name}' is not supported`);
    }
    if (flags & 0x1) throw invalid(`entry '${name}' is encrypted`);
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw invalid(`corrupt local header for '${entry.name}'`);
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw invalid(`entry '${entry.name}' is truncated`);
  const raw = bytes.subarray(start, end);

  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return new Uint8Array(inflateRawSync(raw));
    } catch (err) {
      throw invalid(
        `entry '${entry.name}' failed to decompress: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  throw invalid(`entry '${entry.name}' uses unsupported compression method ${entry.method}`);
}

function readManifestMainDalf(manifest: string): string | undefined {
  // Manifest lines are folded at 72 columns; a continuation starts with one space.
  const unfolded = manifest.replace(/\r?\n /g, '');
  for (const line of unfolded.split(/\r?\n/)) {
    if (line.startsWith('Main-Dalf:')) return line.slice('Main-Dalf:'.length).trim();
  }
  return undefined;
}

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = start;
  while (pos < bytes.length) {
    const byte = bytes[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [result, pos];
    shift += 7;
    if (shift > 63) break;
  }
  throw invalid('corrupt protobuf varint in the main DALF');
}

/** Collects the length-delimited fields 3 (payload) and 4 (hash) of a DALF `Archive`. */
function readArchiveFields(dalf: Uint8Array): { payload?: Uint8Array; hash?: Uint8Array } {
  const fields: { payload?: Uint8Array; hash?: Uint8Array } = {};
  let pos = 0;
  while (pos < dalf.length) {
    let tag: number;
    [tag, pos] = readVarint(dalf, pos);
    const field = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (wireType === 0) {
      [, pos] = readVarint(dalf, pos);
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else if (wireType === 2) {
      let length: number;
      [length, pos] = readVarint(dalf, pos);
      if (pos + length > dalf.length) throw invalid('truncated protobuf field in the main DALF');
      const value = dalf.subarray(pos, pos + length);
      if (field === 3) fields.payload = value;
      if (field === 4) fields.hash = value;
      pos += length;
    } else {
      throw invalid(`unsupported protobuf wire type ${wireType} in the main DALF`);
    }
  }
  return fields;
}

/**
 * Computes the main package ID of a DAR.
 *
 * Reads the zip central directory (stored and deflated entries only), finds the
 * `Main-Dalf` named in `META-INF/MANIFEST.MF`, and returns the package ID
 * stored in that DALF (or the SHA-256 of its payload when the ID field is absent).
 *
 * @param bytes - The raw `.dar` file contents.
 * @returns The 64-character lowercase hex package ID.
 * @throws If the bytes are not a readable DAR (message starts with `Invalid DAR:`).
 */
export function readDarMainPackageId(bytes: Uint8Array): string {
  const entries = readZipEntries(bytes);

  const manifestEntry = entries.get('META-INF/MANIFEST.MF');
  if (!manifestEntry) throw invalid('META-INF/MANIFEST.MF not found');
  const mainDalf = readManifestMainDalf(
    new TextDecoder().decode(readEntry(bytes, manifestEntry)),
  );
  if (!mainDalf) throw invalid('MANIFEST.MF has no Main-Dalf entry');

  const dalfEntry = entries.get(mainDalf);
  if (!dalfEntry) throw invalid(`main DALF '${mainDalf}' not found in the archive`);

  const { payload, hash } = readArchiveFields(readEntry(bytes, dalfEntry));
  let packageId: string | undefined;
  if (hash) {
    packageId = new TextDecoder().decode(hash);
  } else if (payload) {
    packageId = createHash('sha256').update(payload).digest('hex');
  }
  if (!packageId || !PACKAGE_ID_PATTERN.test(packageId)) {
    throw invalid('main DALF does not contain a valid package ID');
  }
  return packageId;
}
