import Conf from 'conf';
import yaml from 'yaml';
import { VERSION } from './constants.js';
import type { ConfigSchema, CredentialsSchema, CredentialKey } from './types.js';

const config = new Conf<ConfigSchema>({
  projectName: 'monid',
  projectSuffix: '',
  configName: 'config',
  fileExtension: 'yaml',
  serialize: yaml.stringify,
  deserialize: yaml.parse,
  defaults: {
    version: VERSION,
    active_key: '',
  },
});

const credentials = new Conf<CredentialsSchema>({
  projectName: 'monid',
  projectSuffix: '',
  configName: 'credentials',
  fileExtension: 'yaml',
  configFileMode: 0o600,
  serialize: yaml.stringify,
  deserialize: yaml.parse,
  defaults: {
    keys: {},
  },
});

// --- Config accessors ---

export function getActiveKeyLabel(): string {
  return config.get('active_key');
}

export function setActiveKeyLabel(label: string): void {
  config.set('active_key', label);
}

export function getConfigPath(): string {
  return config.path;
}

// --- Credential accessors ---

export function getAllKeys(): Record<string, CredentialKey> {
  return credentials.get('keys');
}

export function getKey(label: string): CredentialKey | undefined {
  const keys = getAllKeys();
  return keys[label];
}

export function setKey(
  label: string,
  key: string,
  prefix: string,
): void {
  const keys = getAllKeys();
  keys[label] = {
    key,
    prefix,
    added_at: new Date().toISOString(),
  };
  credentials.set('keys', keys);
}

export function removeKey(label: string): boolean {
  const keys = getAllKeys();
  if (!(label in keys)) return false;
  delete keys[label];
  credentials.set('keys', keys);

  // Deactivate if this was the active key
  if (getActiveKeyLabel() === label) {
    setActiveKeyLabel('');
  }
  return true;
}

export function hasKey(label: string): boolean {
  const keys = getAllKeys();
  return label in keys;
}

export function getActiveKey(): { label: string; credential: CredentialKey } | undefined {
  const label = getActiveKeyLabel();
  if (!label) return undefined;
  const credential = getKey(label);
  if (!credential) return undefined;
  return { label, credential };
}

export function getKeyCount(): number {
  return Object.keys(getAllKeys()).length;
}

export function getCredentialsPath(): string {
  return credentials.path;
}
