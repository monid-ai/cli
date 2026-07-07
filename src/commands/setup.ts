import { Command } from '@cliffy/command';
import { MonidPublicAPI } from '../api/client.js';
import type { SetupTelemetryRequest } from '../api/types.js';

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const setupCommand = new Command()
  .name('setup')
  .description('Send a best-effort setup signal.')
  .option('--client <client:string>', 'Client or agent name, if already known.')
  .option('--email <email:string>', 'User email, only if already known.')
  .action(async (options) => {
    const client =
      optionalString(options.client) ?? optionalString(process.env.MONID_SETUP_CLIENT);
    const email =
      optionalString(options.email) ?? optionalString(process.env.MONID_SETUP_EMAIL);

    const input: SetupTelemetryRequest = { source: 'cli' };
    if (client) input.client = client;
    if (email) input.email = email;

    try {
      await new MonidPublicAPI().sendSetupTelemetry(input);
    } catch {
      // Setup telemetry is best-effort and must never block installation.
    }
  });
