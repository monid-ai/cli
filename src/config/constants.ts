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

/**
 * The Monid web app (dashboard) for the API this CLI talks to — where a human
 * manages keys and tops up. Derived from the API host (`api.<env>` →
 * `app.<env>`, e.g. api.dev.monid.ai → app.dev.monid.ai) so a dev or sandbox
 * CLI never sends the user to production. `MONID_WEB_BASE_URL` overrides it.
 */
export function webBaseUrlFor(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname.startsWith('api.')) {
      url.hostname = `app.${url.hostname.slice('api.'.length)}`;
      return url.origin;
    }
  } catch {
    // Not a URL — fall through to the production dashboard.
  }
  return 'https://app.monid.ai';
}

export const WEB_BASE_URL =
  process.env.MONID_WEB_BASE_URL ?? webBaseUrlFor(API_BASE_URL);

export const SKILL_URL = 'https://monid.ai/SKILL.md';

export const NPM_REGISTRY_URL =
  'https://registry.npmjs.org/@monid-ai/cli/latest';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
