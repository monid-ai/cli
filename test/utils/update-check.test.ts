import { describe, it, expect } from 'bun:test';
import {
  applyUpdateNote,
  getUpdateMessage,
  isNewerVersion,
  type UpdateInfo,
} from '../../src/utils/update-check.js';

const info: UpdateInfo = { currentVersion: '1.0.0', latestVersion: '1.1.0' };

/** Capture everything written to stderr while `fn` runs. */
function captureStderr(fn: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

describe('isNewerVersion', () => {
  it('returns true when latest is strictly newer', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when latest is older', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('applyUpdateNote', () => {
  it('adds a notes array to a plain object', () => {
    const out = applyUpdateNote({ foo: 'bar' }, info) as Record<string, unknown>;
    expect(out.foo).toBe('bar');
    expect(out.notes).toEqual([getUpdateMessage(info).join(' ')]);
  });

  it('appends to an existing notes array rather than replacing it', () => {
    const out = applyUpdateNote({ notes: ['existing'] }, info) as Record<string, unknown>;
    expect(out.notes).toEqual(['existing', getUpdateMessage(info).join(' ')]);
  });

  it('passes through primitives and null unchanged', () => {
    expect(applyUpdateNote(null, info)).toBeNull();
    expect(applyUpdateNote('str', info)).toBe('str');
    expect(applyUpdateNote(42, info)).toBe(42);
  });

  it('does not silently drop the notice for a top-level array', () => {
    // A `notes` property set directly on an array is NOT serialized by
    // JSON.stringify (only indexed elements survive), so embedding it the
    // same way as for objects would make the update notice disappear from
    // `--json` output entirely (e.g. `monid keys list --json`).
    const input = [{ label: 'a' }, { label: 'b' }];
    let out: unknown;
    captureStderr(() => {
      out = applyUpdateNote(input, info);
    });

    expect(out).toBe(input);
    expect(JSON.parse(JSON.stringify(out))).toEqual(input);
  });

  it('surfaces the notice via stderr when the data is a top-level array', () => {
    const input = [{ label: 'a' }];
    const lines = captureStderr(() => {
      applyUpdateNote(input, info);
    });

    const combined = lines.join('\n');
    expect(combined).toContain(info.currentVersion);
    expect(combined).toContain(info.latestVersion);
  });
});
