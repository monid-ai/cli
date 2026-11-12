import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(
  fileURLToPath(new URL('../skills/monid/SKILL.md', import.meta.url)),
  'utf-8',
);

describe('SKILL.md Windows PowerShell guidance', () => {
  const start = skill.indexOf('on Windows PowerShell**');
  const section = start === -1 ? '' : skill.slice(start, skill.indexOf('\n\n**', start + 1) + 2000);

  it('has a troubleshooting entry for the Invalid JSON errors', () => {
    expect(skill).toContain('`Invalid JSON input` / `Invalid JSON for --query` on Windows PowerShell');
  });

  it('points body input at -f and warns about the byte-order mark', () => {
    expect(section).toContain('-f params.json');
    expect(section).toContain('byte-order mark');
  });

  it('shows backslash-escaped quotes for --query and --path', () => {
    expect(section).toContain(String.raw`--query '{\"limit\": 10}'`);
    expect(section).toContain(String.raw`--path '{\"userId\": \"12345\"}'`);
  });

  it('points Flow 4 at the troubleshooting entry', () => {
    expect(skill).toMatch(/On Windows PowerShell 5\.1, prefer `-f` over `-i`/);
  });
});
