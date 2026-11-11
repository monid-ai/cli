import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../src/config/manager.js';
import { VERSION } from '../../src/config/constants.js';

const savedConfigHome = process.env.XDG_CONFIG_HOME;
let home: string;
let configDir: string;

/** A cache stamp that is fresh, so the constructor does not call npm. */
const fresh = () => `last_update_check: "${new Date().toISOString()}"\n`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'monid-config-'));
  process.env.XDG_CONFIG_HOME = home;
  configDir = join(home, 'monid');
  mkdirSync(configDir);
});

afterEach(() => {
  chmodSync(configDir, 0o755);
  rmSync(home, { recursive: true, force: true });
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
});

describe('ConfigManager does not write on construction', () => {
  it('leaves an up-to-date config dir untouched', () => {
    const configFile = join(configDir, 'config.yaml');
    writeFileSync(configFile, `version: ${VERSION}\nactive_key: test\n${fresh()}`);
    const before = readFileSync(configFile, 'utf8');
    const mtime = statSync(configFile).mtimeMs;

    const config = new ConfigManager();
    config.getAllKeys();
    config.getActiveKey();

    expect(readFileSync(configFile, 'utf8')).toBe(before);
    expect(statSync(configFile).mtimeMs).toBe(mtime);
    // No credentials.yaml is created just by reading.
    expect(readdirSync(configDir)).toEqual(['config.yaml']);
  });

  it('applies defaults when the files do not exist', () => {
    writeFileSync(join(configDir, 'config.yaml'), `version: ${VERSION}\n${fresh()}`);
    const config = new ConfigManager();
    expect(config.getActiveKeyLabel()).toBe('');
    expect(config.getAllKeys()).toEqual({});
    expect(config.getKeyCount()).toBe(0);
  });

  it('still persists real changes', () => {
    writeFileSync(join(configDir, 'config.yaml'), `version: ${VERSION}\n${fresh()}`);
    const config = new ConfigManager();
    config.addKey('a', 'k', 'p');
    config.activateKey('a');
    const again = new ConfigManager();
    expect(again.getActiveKey()?.credential.key).toBe('k');
  });

  it('works from a read-only config dir, even when the stored version is stale', () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return; // chmod does not bind root
    writeFileSync(join(configDir, 'config.yaml'), `version: 0.0.1\nactive_key: test\n${fresh()}`);
    writeFileSync(join(configDir, 'credentials.yaml'),
      'keys:\n  test:\n    key: test-key\n    prefix: test\n    added_at: "2026-10-26T00:00:00.000Z"\n');
    chmodSync(configDir, 0o555);
    chmodSync(join(configDir, 'config.yaml'), 0o444);

    const config = new ConfigManager();
    expect(config.getActiveKey()?.credential.key).toBe('test-key');
    expect(() => config.activateKey('other')).toThrow(); // real writes still report
  });
});
