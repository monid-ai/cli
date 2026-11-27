import { readFileSync } from 'node:fs';

/** Drop a leading UTF-8 byte order mark, which JSON.parse rejects. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read a JSON body from a file. Windows PowerShell 5.1 writes a UTF-8 BOM with
 * `Set-Content -Encoding UTF8`, so a leading BOM is ignored. Errors say whether
 * the file could not be read or is not valid JSON, and hint at the encoding.
 */
export function readJsonInputFile(path: string): Record<string, unknown> {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    throw new Error(`Failed to read input file: ${path} (${(err as Error).message})`);
  }
  // UTF-16 (PowerShell's default for `>` and Out-File) starts with FF FE or FE FF.
  if ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) {
    throw new Error(
      `Input file is UTF-16 encoded, not UTF-8: ${path}. Save it as UTF-8 ` +
        '(in PowerShell: Set-Content -Encoding utf8, or Out-File -Encoding utf8).',
    );
  }
  try {
    return JSON.parse(stripBom(raw.toString('utf-8')));
  } catch (err) {
    throw new Error(
      `Input file is not valid JSON: ${path} (${(err as Error).message}). ` +
        'The file must be UTF-8 encoded JSON.',
    );
  }
}
