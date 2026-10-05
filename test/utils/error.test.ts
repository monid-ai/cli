import { describe, expect, it } from 'bun:test';
import { isRateLimited, MonidError, rateLimitedMessage } from '../../src/utils/error.js';

describe('rate-limit messages', () => {
  it('names what was limited and the wait', () => {
    const err = new MonidError('RATE_LIMITED', 'Rate limited. Retry after 37s.', 429, {
      retryAfterSec: 37,
      limitedOn: 'tinyfish /search',
    });
    expect(isRateLimited(err)).toBe(true);
    expect(rateLimitedMessage(err)).toBe('Rate limited on tinyfish /search. Retry after 37s.');
  });

  it('falls back gracefully without a wait or label', () => {
    const err = new MonidError('RATE_LIMITED', 'x', 429);
    expect(rateLimitedMessage(err)).toBe('Rate limited. Please try again later.');
  });

  it('other errors are not rate limits', () => {
    expect(isRateLimited(new MonidError('NOT_FOUND', 'x', 404))).toBe(false);
    expect(isRateLimited(new Error('x'))).toBe(false);
  });
});
