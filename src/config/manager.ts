import Conf from 'conf';
import yaml from 'yaml';
import { VERSION, UPDATE_CHECK_INTERVAL_MS } from './constants.js';
import { resolveConfigDir } from './paths.js';
import { fetchLatestVersion, isNewerVersion } from '../utils/update-check.js';
import type { UpdateInfo } from '../utils/update-check.js';
import type { ConfigSchema, CredentialsSchema, CredentialKey } from './types.js';

export class ConfigManager {
  private config: Conf<ConfigSchema>;
  private credentials: Conf<CredentialsSchema>;
  private _updateCheckPromise: Promise<void> | null = null;

  constructor() {
    const configDir = resolveConfigDir();

    this.config = new Conf<ConfigSchema>({
      projectName: 'monid',
      projectSuffix: '',
      configName: 'config',
      fileExtension: 'yaml',
      cwd: configDir,
      serialize: yaml.stringify,
      deserialize: yaml.parse,
      defaults: {
        version: VERSION,
        active_key: '',
      },
    });

    this.credentials = new Conf<CredentialsSchema>({
      projectName: 'monid',
      projectSuffix: '',
      configName: 'credentials',
      fileExtension: 'yaml',
      cwd: configDir,
      configFileMode: 0o600,
      serialize: yaml.stringify,
      deserialize: yaml.parse,
      defaults: {
        keys: {},
      },
    });

    // Keep config version in sync with installed CLI version
    this.config.set('version', VERSION);

    // Start background update check if cache is stale
    const lastCheck = this.config.get('last_update_check');
    const isStale =
      !lastCheck ||
      Date.now() - new Date(lastCheck).getTime() > UPDATE_CHECK_INTERVAL_MS;

    if (isStale) {
      this._updateCheckPromise = fetchLatestVersion()
        .then((version) => {
          if (version) {
            this.config.set('latest_version', version);
          }
          this.config.set('last_update_check', new Date().toISOString());
        })
        .catch(() => {});
    }
  }

  // --- Key management ---

  getActiveKey(): { label: string; credential: CredentialKey } | undefined {
    const label = this.getActiveKeyLabel();
    if (!label) return undefined;
    const credential = this.getKey(label);
    if (!credential) return undefined;
    return { label, credential };
  }

  getActiveKeyLabel(): string {
    return this.config.get('active_key');
  }

  activateKey(label: string): void {
    this.config.set('active_key', label);
  }

  getAllKeys(): Record<string, CredentialKey> {
    return this.credentials.get('keys');
  }

  getKey(label: string): CredentialKey | undefined {
    const keys = this.getAllKeys();
    return keys[label];
  }

  addKey(label: string, key: string, prefix: string): void {
    const keys = this.getAllKeys();
    keys[label] = {
      key,
      prefix,
      added_at: new Date().toISOString(),
    };
    this.credentials.set('keys', keys);
  }

  removeKey(label: string): boolean {
    const keys = this.getAllKeys();
    if (!(label in keys)) return false;
    delete keys[label];
    this.credentials.set('keys', keys);

    if (this.getActiveKeyLabel() === label) {
      this.activateKey('');
    }
    return true;
  }

  hasKey(label: string): boolean {
    const keys = this.getAllKeys();
    return label in keys;
  }

  getKeyCount(): number {
    return Object.keys(this.getAllKeys()).length;
  }

  // --- Update check ---

  async getUpdateInfo(): Promise<UpdateInfo | null> {
    // If a background fetch is in progress, wait for it to finish
    if (this._updateCheckPromise) {
      await this._updateCheckPromise;
      this._updateCheckPromise = null;
    }

    const latestVersion = this.config.get('latest_version');
    if (!latestVersion) return null;

    if (isNewerVersion(VERSION, latestVersion)) {
      return { currentVersion: VERSION, latestVersion };
    }

    return null;
  }

  // --- Paths ---

  getConfigPath(): string {
    return this.config.path;
  }

  getCredentialsPath(): string {
    return this.credentials.path;
  }
}
