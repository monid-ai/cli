import { Command } from '@cliffy/command';
import { walletPromoCodesCommand } from './promo-codes.js';
import { walletRedeemCommand } from './redeem.js';

export const walletCommand = new Command()
  .name('wallet')
  .description('Wallet: redeemed promo codes and the signup credit.')
  .action(function () {
    this.showHelp();
  })
  .command('promo-codes', walletPromoCodesCommand)
  .command('redeem', walletRedeemCommand);
