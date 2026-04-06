import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the monid config directory.
 *
 * Priority:
 *   1. $XDG_CONFIG_HOME/monid/  (if XDG_CONFIG_HOME is set)
 *   2. ~/.config/monid/         (fallback)
 */
export function resolveConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), '.config');
  return join(base, 'monid');
}
