import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonInputFile } from '../../src/utils/input-file.js';

const dir = mkdtempSync(join(tmpdir(), 'monid-input-file-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, bytes: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

describe('readJsonInputFile', () => {
  it('reads plain UTF-8 JSON', () => {
    expect(readJsonInputFile(file('plain.json', '{"q":"a"}'))).toEqual({ q: 'a' });
  });

  it('ignores a leading UTF-8 BOM (PowerShell 5.1 Set-Content -Encoding UTF8)', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"q":"é"}')]);
    expect(readJsonInputFile(file('bom.json', bytes))).toEqual({ q: 'é' });
  });

  it('names UTF-16 as the problem instead of a bare parse failure', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"q":"a"}', 'utf16le')]);
    expect(() => readJsonInputFile(file('utf16.json', bytes))).toThrow(/UTF-16/);
  });

  it('says the file is not valid JSON and mentions encoding', () => {
    expect(() => readJsonInputFile(file('bad.json', '{nope'))).toThrow(/not valid JSON.*UTF-8/);
  });

  it('says the file could not be read when it is missing', () => {
    expect(() => readJsonInputFile(join(dir, 'missing.json'))).toThrow(/Failed to read input file/);
  });
});
