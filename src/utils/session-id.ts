import { randomBytes } from 'node:crypto';

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Session IDs only need to be unique per user (the API key identifies the user). */
export const SESSION_ID_LENGTH = 8;

/**
 * Generate a short random base62 session ID.
 * 8 chars ≈ 47.6 bits: ~1-in-40,000 chance of any collision across 100,000 IDs.
 */
export function generateSessionId(length: number = SESSION_ID_LENGTH): string {
  let id = '';
  while (id.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // Reject bytes >= 248 (62 * 4) so every character is equally likely.
      if (byte >= 248) continue;
      id += ALPHABET[byte % 62];
      if (id.length === length) break;
    }
  }
  return id;
}
