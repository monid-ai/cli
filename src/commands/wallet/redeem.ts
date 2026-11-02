import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatRedeemPromoCode } from '../../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../../output/spinner.js';

/** Trim + upper-case, the server's own normalization; empty is an error. */
export function normalizeRedeemCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!code) {
    throw new MonidError('INVALID_INPUT', 'Promo code cannot be empty.');
  }
  if (code.length > 64) {
    throw new MonidError('INVALID_INPUT', 'Promo code is too long (max 64 characters).');
  }
  return code;
}

export const walletRedeemCommand = new Command()
  .name('redeem')
  .description(
    'Redeem a promo code for this workspace. With an API key only the signup credit code (e.g. MONID-SIGNUP) can be redeemed; other codes are redeemed in the Monid dashboard.',
  )
  .arguments('<code:string>')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ json }, rawCode) => {
    try {
      const code = normalizeRedeemCode(rawCode);
      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (!json) {
        startSpinner(`Redeeming ${code}...`);
      }

      const data = await api.redeemPromoCode(code);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner('Promo code redeemed');
        formatRedeemPromoCode(code, data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
