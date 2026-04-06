import { Command } from '@cliffy/command';
import { keysAddCommand } from './add.js';
import { keysListCommand } from './list.js';
import { keysRemoveCommand } from './remove.js';
import { keysActivateCommand } from './activate.js';

export const keysCommand = new Command()
  .name('keys')
  .description('Manage API keys.')
  .action(function () {
    this.showHelp();
  })
  .command('add', keysAddCommand)
  .command('list', keysListCommand)
  .command('remove', keysRemoveCommand)
  .command('activate', keysActivateCommand);
