declare const __PKG_VERSION__: string;

function getVersion(): string {
  if (typeof __PKG_VERSION__ !== 'undefined') return __PKG_VERSION__;
  // Dev mode fallback — read package.json at runtime
  try {
    const { readFileSync } = require('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0-dev';
  }
}

export const VERSION = getVersion();

export const API_BASE_URL =
  process.env.MONID_API_BASE_URL ?? 'https://api.monid.ai';

export const SKILL_URL = 'https://monid.ai/SKILL.md';

export const NPM_REGISTRY_URL =
  'https://registry.npmjs.org/@monid-ai/cli/latest';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
