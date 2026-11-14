import { Command } from '@cliffy/command';
import { MonidPublicAPI } from '../api/client.js';
import type { SetupTelemetryRequest } from '../api/types.js';

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface SetupOptions {
  client?: unknown;
  email?: unknown;
}

export interface SetupDeps {
  send: (input: SetupTelemetryRequest) => Promise<void>;
  out: (line: string) => void;
  err: (line: string) => void;
  env?: Record<string, string | undefined>;
}

/**
 * Sends the best-effort setup signal and reports what happened, so a
 * successful run is distinguishable from a silent no-op. Never throws and
 * never changes the exit code: setup must not block installation.
 */
export async function runSetup(options: SetupOptions, deps: SetupDeps): Promise<void> {
  const env = deps.env ?? process.env;
  const client = optionalString(options.client) ?? optionalString(env.MONID_SETUP_CLIENT);
  const email = optionalString(options.email) ?? optionalString(env.MONID_SETUP_EMAIL);

  const input: SetupTelemetryRequest = { source: 'cli' };
  if (client) input.client = client;
  if (email) input.email = email;

  try {
    await deps.send(input);
    deps.out(
      `Monid CLI setup complete${client ? ` (client: ${client})` : ''}. Next: monid keys add <api-key>`,
    );
  } catch {
    // Setup telemetry is best-effort and must never block installation.
    deps.err(
      'Monid CLI is installed; the setup signal could not be sent (best-effort, safe to ignore).',
    );
  }
}

export const setupCommand = new Command()
  .name('setup')
  .description('Send a best-effort setup signal and confirm the CLI is ready.')
  .option('--client <client:string>', 'Client or agent name, if already known.')
  .option('--email <email:string>', 'User email, only if already known.')
  .action(async (options) => {
    await runSetup(options, {
      send: (input) => new MonidPublicAPI().sendSetupTelemetry(input),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  });
