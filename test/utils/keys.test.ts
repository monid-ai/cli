import { describe, it, expect } from 'bun:test';
import {
  validateApiKeyFormat,
  extractApiKeyPrefix,
  obfuscateApiKey,
} from '../../src/utils/keys.js';

describe('validateApiKeyFormat', () => {
  it('accepts valid keys with 3+ parts starting with monid', () => {
    expect(validateApiKeyFormat('monid_live_abc123')).toBe(true);
    expect(validateApiKeyFormat('monid_test_xyz789')).toBe(true);
    expect(validateApiKeyFormat('monid_live_some_long_key')).toBe(true);
  });

  it('rejects keys with fewer than 3 parts', () => {
    expect(validateApiKeyFormat('monid_live')).toBe(false);
    expect(validateApiKeyFormat('monid')).toBe(false);
    expect(validateApiKeyFormat('')).toBe(false);
  });

  it('rejects keys not starting with monid', () => {
    expect(validateApiKeyFormat('other_live_abc123')).toBe(false);
    expect(validateApiKeyFormat('sk_live_abc123')).toBe(false);
  });
});

describe('extractApiKeyPrefix', () => {
  it('extracts prefix (everything except last segment)', () => {
    expect(extractApiKeyPrefix('monid_live_abc123')).toBe('monid_live');
    expect(extractApiKeyPrefix('monid_test_xyz789')).toBe('monid_test');
  });

  it('handles keys with multiple segments', () => {
    expect(extractApiKeyPrefix('monid_live_some_long_key')).toBe(
      'monid_live_some_long',
    );
  });
});

describe('obfuscateApiKey', () => {
  it('shows prefix and last char with dots', () => {
    const result = obfuscateApiKey('monid_live_abc123');
    expect(result).toContain('monid_live_');
    expect(result).toEndWith('3');
    expect(result).toContain('······');
  });

  it('handles short keys gracefully', () => {
    expect(obfuscateApiKey('ab')).toBe('***');
  });
});
