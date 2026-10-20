import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test } from '@playwright/test';
import { crc32, listFiles, zipDirectory } from '../../src/app/zip';

/** Reads a zip's entries back through its central directory, as an unzip tool does. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(zip.subarray(start, start + size));
    expect(crc32(data)).toBe(zip.readUInt32LE(at + 16));
    files[name] = data.toString('utf8');
    at += 46 + nameLength;
  }
  return files;
}

test('CRC-32 matches the standard check value', () => {
  expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
});

test('the Share zip holds the whole run folder inside one folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oca-share-'));
  try {
    fs.mkdirSync(path.join(dir, 'output', 'html', 'JOB-001'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'activity.log'), '[INFO] Code version: commit abc\n');
    fs.writeFileSync(path.join(dir, 'output', 'html', 'JOB-001', '01-FAILED-Save.html'), '<html>capture</html>');
    expect(listFiles(dir).sort()).toEqual(['activity.log', 'output/html/JOB-001/01-FAILED-Save.html']);
    expect(unzip(zipDirectory(dir, 'OCA-run-test'))).toEqual({
      'OCA-run-test/activity.log': '[INFO] Code version: commit abc\n',
      'OCA-run-test/output/html/JOB-001/01-FAILED-Save.html': '<html>capture</html>',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
