import * as http from 'node:http';
import * as net from 'node:net';

/**
 * How long one address of a dual-stack host gets to connect before Node's
 * "happy eyeballs" moves to the next one. Node's own default is 250 ms, which
 * is shorter than a normal TCP+TLS handshake over a slow, VPN'd or
 * IPv6-first-but-broken route: every address is abandoned before it can
 * answer and the request ends in ETIMEDOUT / UND_ERR_CONNECT_TIMEOUT even
 * though curl (which waits longer) connects fine.
 * https://nodejs.org/api/net.html#netsetdefaultautoselectfamilyattempttimeoutvalue
 */
export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2000;

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

export interface NetworkDeps {
  env: NodeJS.ProcessEnv;
  /** Node CLI flags, e.g. process.execArgv. */
  execArgv: readonly string[];
  setAutoSelectFamily: (enabled: boolean) => void;
  setAttemptTimeout: (ms: number) => void;
  /** Node >= 22.21 / 24.5 only; undefined on older Node. */
  setGlobalProxyFromEnv?: () => unknown;
}

function defaultDeps(): NetworkDeps {
  const n = net as unknown as {
    setDefaultAutoSelectFamily?: (v: boolean) => void;
    setDefaultAutoSelectFamilyAttemptTimeout?: (v: number) => void;
  };
  const h = http as unknown as { setGlobalProxyFromEnv?: () => unknown };
  return {
    env: process.env,
    execArgv: process.execArgv,
    setAutoSelectFamily: (v) => n.setDefaultAutoSelectFamily?.(v),
    setAttemptTimeout: (v) => n.setDefaultAutoSelectFamilyAttemptTimeout?.(v),
    setGlobalProxyFromEnv: h.setGlobalProxyFromEnv?.bind(http),
  };
}

/** True where Node can switch on HTTPS_PROXY handling after startup. */
export function canApplyProxyInProcess(): boolean {
  return typeof (http as unknown as { setGlobalProxyFromEnv?: unknown }).setGlobalProxyFromEnv === 'function';
}

export function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  return PROXY_VARS.some((k) => !!env[k]);
}

/**
 * Make Node's `fetch` behave on the networks curl already copes with. Call
 * once, before the first request.
 *
 * - Address selection: keep happy-eyeballs on (off by default before Node 20)
 *   and give each address 2 s instead of 250 ms. An explicit
 *   `--network-family-autoselection*` flag or `--no-network-family-…` in
 *   argv/NODE_OPTIONS is the user's choice and is left alone.
 * - Proxy: Node's fetch ignores HTTPS_PROXY / HTTP_PROXY / NO_PROXY unless
 *   NODE_USE_ENV_PROXY=1 was set before the process started, so behind a
 *   proxy it dials the API directly and times out. When a proxy variable is
 *   set and that opt-in is missing, switch it on in-process where Node
 *   supports it (http.setGlobalProxyFromEnv). NO_PROXY is honoured by Node.
 *   https://nodejs.org/api/http.html#httpsetglobalproxyfromenvproxyenv
 */
export function configureNetwork(deps: NetworkDeps = defaultDeps()): void {
  const flags = [...deps.execArgv, ...(deps.env.NODE_OPTIONS?.split(/\s+/) ?? [])];
  const userTunedFamily = flags.some((f) => f.includes('network-family-autoselection'));
  if (!userTunedFamily) {
    try {
      deps.setAutoSelectFamily(true);
      deps.setAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
    } catch {
      // Tuning is best effort; never stop the CLI from starting.
    }
  }

  const optedIn = deps.env.NODE_USE_ENV_PROXY === '1';
  if (!optedIn && hasProxyEnv(deps.env) && deps.setGlobalProxyFromEnv) {
    try {
      deps.setGlobalProxyFromEnv();
    } catch {
      // Malformed proxy URL: fall back to a direct connection.
    }
  }
}
