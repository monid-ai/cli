import { Command } from '@cliffy/command';
import { walletPromoCodesCommand } from './promo-codes/index.js';

export const walletCommand = new Command()
  .name('wallet')
  .description('Manage the workspace wallet.')
  .action(function () {
    this.showHelp();
  })
  .command('promo-codes', walletPromoCodesCommand);
