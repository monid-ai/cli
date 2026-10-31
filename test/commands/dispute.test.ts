import { describe, it, expect } from 'bun:test';
import {
  buildDisputeRequest,
  DISPUTE_RUN_IDS_MAX,
  DISPUTE_TEXT_MAX,
} from '../../src/commands/dispute.js';
import { MonidError } from '../../src/utils/error.js';

const base = {
  runIds: ['run-a'],
  reason: 'Returned posts from 2023, not the latest.',
  userQuery: 'Find the latest posts from @monid on X.',
};

function errorOf(fn: () => unknown): MonidError {
  try {
    fn();
  } catch (err) {
    return err as MonidError;
  }
  throw new Error('expected an error');
}

describe('buildDisputeRequest', () => {
  it('builds the minimal body, with the disputed runs in context.runIds', () => {
    expect(buildDisputeRequest(base)).toEqual({
      runIds: ['run-a'],
      reason: base.reason,
      context: { userQuery: base.userQuery, runIds: ['run-a'] },
    });
  });

  it('turns discover queries into { q } request bodies', () => {
    const body = buildDisputeRequest({
      ...base,
      discoverQueries: ['twitter posts', ' x posts '],
    });
    expect(body.context.discoverRequests).toEqual([
      { q: 'twitter posts' },
      { q: 'x posts' },
    ]);
  });

  it('de-duplicates run IDs and merges context runs after the disputed ones', () => {
    const body = buildDisputeRequest({
      ...base,
      runIds: ['run-a', 'run-b', 'run-a'],
      contextRunIds: ['run-c', 'run-b'],
    });
    expect(body.runIds).toEqual(['run-a', 'run-b']);
    expect(body.context.runIds).toEqual(['run-a', 'run-b', 'run-c']);
  });

  it('trims the reason and user query', () => {
    const body = buildDisputeRequest({ ...base, reason: '  stale  ', userQuery: ' latest posts ' });
    expect(body.reason).toBe('stale');
    expect(body.context.userQuery).toBe('latest posts');
  });

  it('rejects empty text', () => {
    expect(errorOf(() => buildDisputeRequest({ ...base, reason: '   ' })).message)
      .toBe('Reason cannot be empty.');
    expect(errorOf(() => buildDisputeRequest({ ...base, userQuery: '' })).message)
      .toBe('User query cannot be empty.');
    expect(errorOf(() => buildDisputeRequest({ ...base, discoverQueries: [' '] })).message)
      .toBe('Discover query cannot be empty.');
  });

  it('rejects text over the limit', () => {
    const err = errorOf(() =>
      buildDisputeRequest({ ...base, reason: 'x'.repeat(DISPUTE_TEXT_MAX + 1) }),
    );
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain(`limit is ${DISPUTE_TEXT_MAX}`);
  });

  it('rejects blank run IDs and too many runs', () => {
    expect(errorOf(() => buildDisputeRequest({ ...base, runIds: [' '] })).message)
      .toBe('At least one run ID is required.');
    const many = Array.from({ length: DISPUTE_RUN_IDS_MAX + 1 }, (_, i) => `run-${i}`);
    expect(errorOf(() => buildDisputeRequest({ ...base, runIds: many })).message)
      .toContain('Too many disputed runs');
  });
});
