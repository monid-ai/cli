import { describe, it, expect } from 'bun:test';
import {
  generateSessionId,
  SESSION_ID_LENGTH,
} from '../../src/utils/session-id.js';

describe('generateSessionId', () => {
  it('returns a base62 string of the default length', () => {
    const id = generateSessionId();
    expect(id).toHaveLength(SESSION_ID_LENGTH);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
  });

  it('respects a custom length', () => {
    expect(generateSessionId(20)).toHaveLength(20);
  });

  it('does not repeat across many calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => generateSessionId()));
    expect(ids.size).toBe(10_000);
  });
});
