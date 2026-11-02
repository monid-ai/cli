import { Command } from '@cliffy/command';
import { walletPromoCodesListCommand } from './list.js';
import { walletPromoCodesRedeemCommand } from './redeem.js';

export const walletPromoCodesCommand = new Command()
  .name('promo-codes')
  .description('List and redeem promo codes.')
  .action(function () {
    this.showHelp();
  })
  .command('list', walletPromoCodesListCommand)
  .command('redeem', walletPromoCodesRedeemCommand);
