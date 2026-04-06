export interface ConfigSchema {
  version: string;
  active_key: string;
}

export interface CredentialKey {
  key: string;
  prefix: string;
  added_at: string;
}

export interface CredentialsSchema {
  keys: Record<string, CredentialKey>;
}
