import chalk from 'chalk';
import { VERSION, SKILL_URL, NPM_REGISTRY_URL } from '../config/constants.js';

/** How long the registry check may take, headers AND body included. */
export const UPDATE_FETCH_TIMEOUT_MS = 2000;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
}

/**
 * Fetch the latest published version from the npm registry.
 * Uses a 2-second timeout and silently returns null on any failure.
 *
 * The timer is cleared in `finally`, AFTER the body is consumed: clearing it
 * as soon as headers arrive left `res.json()` with no deadline, so a registry
 * that stalled mid-body could keep the process alive. That did not matter
 * while errors ended with process.exit(); now that handleError only sets
 * exitCode and lets the loop drain, every pending handle must bound itself.
 */
export async function fetchLatestVersion(
  timeoutMs: number = UPDATE_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      // Not reading the body would leave the connection open past the
      // deadline once the timer is cleared below; abort releases it.
      controller.abort();
      return null;
    }

    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare two semver strings. Returns true if `latest` is strictly newer than `current`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

/**
 * Build the human-readable update message string.
 */
export function getUpdateMessage(info: UpdateInfo): string[] {

  return [`Update available: ${info.currentVersion} \u2192 ${info.latestVersion}.`,
    `Run \`npm update -g @monid-ai/cli\` to update monid-cli.`,
    `Download the latest version of skill at ${SKILL_URL}.`];
}

/**
 * Print the update notice to stderr in warning color.
 */
export function printUpdateNotice(info: UpdateInfo): void {
  const msg = getUpdateMessage(info).join('\n  ')
  console.error(chalk.yellow(`\n${msg}`));
}

/**
 * For --json mode: append the update message to the `notes` array on the
 * response object. Creates the array if it doesn't exist.
 * Returns the modified object.
 *
 * Top-level arrays (e.g. `monid keys list --json`) are passed through
 * unchanged: `JSON.stringify` only serializes an array's indexed elements,
 * so setting a `notes` property on it would be silently dropped from the
 * output, losing the notice entirely. Print it to stderr instead so it
 * still reaches the user without corrupting the piped-to-stdout JSON.
 */
export function applyUpdateNote(data: unknown, info: UpdateInfo): unknown {
  if (data === null || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    printUpdateNotice(info);
    return data;
  }

  const obj = data as Record<string, unknown>;
  const message = getUpdateMessage(info).join(" ");

  if (Array.isArray(obj.notes)) {
    obj.notes = [...obj.notes, message];
  } else {
    obj.notes = [message];
  }

  return obj;
}
