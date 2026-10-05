/** Uncompressed (STORE) zip. Good enough for a design pack of already-compressed images. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readU16(bytes: Uint8Array, i: number) {
  return bytes[i] | (bytes[i + 1] << 8);
}

function readU32(bytes: Uint8Array, i: number) {
  return (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

export function writeZip(files: ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name.replace(/\\/g, "/"));
    const data = file.data;
    const crc = crc32(data);
    const header = concat([
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    local.push(header, data);
    central.push(
      concat([
        Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ])
    );
    offset += header.length + data.length;
  }
  const localBytes = concat(local);
  const centralBytes = concat(central);
  const eocd = concat([
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(localBytes.length),
    u16(0),
  ]);
  return concat([localBytes, centralBytes, eocd]);
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  if (!isZipBytes(bytes)) throw new Error("Not a zip file");
  let eocd = -1;
  const max = Math.min(bytes.length - 22, 0xffff);
  for (let i = bytes.length - 22; i >= bytes.length - 22 - max && i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Zip directory missing");
  const count = readU16(bytes, eocd + 10);
  let offset = readU32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (readU32(bytes, offset) !== 0x02014b50) throw new Error("Bad zip directory");
    const method = readU16(bytes, offset + 10);
    const comp = readU32(bytes, offset + 20);
    const uncomp = readU32(bytes, offset + 24);
    const nameLen = readU16(bytes, offset + 28);
    const extraLen = readU16(bytes, offset + 30);
    const commentLen = readU16(bytes, offset + 32);
    const localOff = readU32(bytes, offset + 42);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (method !== 0) throw new Error(`Zip entry ${name} is compressed`);
    const localNameLen = readU16(bytes, localOff + 26);
    const localExtra = readU16(bytes, localOff + 28);
    const start = localOff + 30 + localNameLen + localExtra;
    entries.push({ name, data: bytes.subarray(start, start + (uncomp || comp)) });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
