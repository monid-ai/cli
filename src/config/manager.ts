import Conf from 'conf';
import yaml from 'yaml';
import { VERSION } from './constants.js';
import { resolveConfigDir } from './paths.js';
import type { ConfigSchema, CredentialsSchema, CredentialKey } from './types.js';

export class ConfigManager {
  private config: Conf<ConfigSchema>;
  private credentials: Conf<CredentialsSchema>;

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

  // --- Paths ---

  getConfigPath(): string {
    return this.config.path;
  }

  getCredentialsPath(): string {
    return this.credentials.path;
  }
}
