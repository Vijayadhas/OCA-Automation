import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Every file under a folder, as paths relative to it with forward slashes. */
export function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return entry.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

/**
 * A zip archive (deflate) of the given files, each stored as `<folder>/<relative path>` so the
 * archive opens into one folder. Node's zlib only: the run system needs no extra package.
 */
export function zipFiles(files: Array<{ name: string; data: Buffer; modified?: Date }>, folder: string): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(`${folder}/${file.name}`, 'utf8');
    const compressed = zlib.deflateRawSync(file.data);
    const date = file.modified ?? new Date();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14); header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(file.data.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed);
    central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** A zip of a whole folder (input, Activity log, results, HTML captures, traces), opening into `folder`. */
export function zipDirectory(dir: string, folder: string): Buffer {
  return zipFiles(listFiles(dir).map((name) => {
    const full = path.join(dir, ...name.split('/'));
    return { name, data: fs.readFileSync(full), modified: fs.statSync(full).mtime };
  }), folder);
}
