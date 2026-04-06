/**
 * Validate that an API key has the correct format: monid_<stage>_<secret>
 * Must have at least 3 underscore-separated parts, first part must be "monid".
 */
export function validateApiKeyFormat(key: string): boolean {
  const parts = key.split('_');
  if (parts.length < 3) return false;
  if (parts[0] !== 'monid') return false;
  return true;
}

/**
 * Extract the prefix from an API key (everything except the last underscore segment).
 * e.g., "monid_live_abc123def456" -> "monid_live"
 */
export function extractApiKeyPrefix(key: string): string {
  const parts = key.split('_');
  return parts.slice(0, -1).join('_');
}

/**
 * Obfuscate an API key for display.
 * Shows the prefix and last character, dots in between.
 * e.g., "monid_live_abc123def456" -> "monid_live_......6"
 */
export function obfuscateApiKey(key: string): string {
  const parts = key.split('_');
  if (parts.length < 3) return '***';
  const prefix = parts.slice(0, -1).join('_');
  const secret = parts[parts.length - 1];
  const lastChar = secret.length > 0 ? secret[secret.length - 1] : '';
  return `${prefix}_${'·'.repeat(6)}${lastChar}`;
}
