import { describe, it, expect } from 'bun:test';
import {
  AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
  configureNetwork,
  type NetworkDeps,
} from '../../src/utils/network.js';
import { networkEnvHint } from '../../src/api/client.js';

function deps(over: Partial<NetworkDeps> = {}) {
  const calls = { family: [] as boolean[], timeout: [] as number[], proxy: 0 };
  const d: NetworkDeps = {
    env: {},
    execArgv: [],
    setAutoSelectFamily: (v) => void calls.family.push(v),
    setAttemptTimeout: (v) => void calls.timeout.push(v),
    setGlobalProxyFromEnv: () => void calls.proxy++,
    ...over,
  };
  return { d, calls };
}

describe('configureNetwork', () => {
  it('enables address autoselection with a timeout longer than Node default 250ms', () => {
    const { d, calls } = deps();
    configureNetwork(d);
    expect(calls.family).toEqual([true]);
    expect(calls.timeout).toEqual([AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS]);
    expect(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(250);
  });

  it('leaves address selection alone when the user set a Node flag', () => {
    const a = deps({ execArgv: ['--network-family-autoselection-attempt-timeout=500'] });
    configureNetwork(a.d);
    expect(a.calls.timeout).toEqual([]);
    const b = deps({ env: { NODE_OPTIONS: '--no-network-family-autoselection' } });
    configureNetwork(b.d);
    expect(b.calls.family).toEqual([]);
  });

  it('turns on env proxy support when a proxy variable is set', () => {
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
      const { d, calls } = deps({ env: { [k]: 'http://proxy.local:3128' } });
      configureNetwork(d);
      expect(calls.proxy).toBe(1);
    }
  });

  it('does nothing about proxies without a proxy variable, or when already opted in', () => {
    const a = deps();
    configureNetwork(a.d);
    expect(a.calls.proxy).toBe(0);
    const b = deps({ env: { HTTPS_PROXY: 'http://p:1', NODE_USE_ENV_PROXY: '1' } });
    configureNetwork(b.d);
    expect(b.calls.proxy).toBe(0);
  });

  it('survives a Node without the proxy API or with a bad proxy URL', () => {
    const a = deps({ env: { HTTPS_PROXY: 'http://p:1' }, setGlobalProxyFromEnv: undefined });
    expect(() => configureNetwork(a.d)).not.toThrow();
    const b = deps({
      env: { HTTPS_PROXY: '::bad' },
      setGlobalProxyFromEnv: () => {
        throw new Error('bad url');
      },
    });
    expect(() => configureNetwork(b.d)).not.toThrow();
  });
});

describe('networkEnvHint', () => {
  const failed = (code: string, msg = code) =>
    new TypeError('fetch failed', { cause: Object.assign(new Error(msg), { code }) });

  it('points to NODE_EXTRA_CA_CERTS for certificate errors', () => {
    const h = networkEnvHint(failed('UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'unable to get local issuer certificate'));
    expect(h).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('explains an ignored proxy on a Node that cannot apply it', () => {
    const h = networkEnvHint(failed('ETIMEDOUT'), { HTTPS_PROXY: 'http://p:1' }, false);
    expect(h).toContain('ignores it for fetch');
  });

  it('suggests proxy / IPv4 checks for plain timeouts and DNS failures', () => {
    expect(networkEnvHint(failed('UND_ERR_CONNECT_TIMEOUT'), {}, true)).toContain('ipv4first');
    expect(networkEnvHint(failed('ENOTFOUND'), {}, true)).toContain('NODE_USE_ENV_PROXY=1');
  });

  it('adds nothing for unrelated failures', () => {
    expect(networkEnvHint(failed('ECONNRESET'))).toBe('');
  });
});
