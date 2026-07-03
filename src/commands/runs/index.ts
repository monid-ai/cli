import { Command } from '@cliffy/command';
import { runsListCommand } from './list.js';
import { runsGetCommand } from './get.js';
import { runsStopCommand } from './stop.js';

export const runsCommand = new Command()
  .name('runs')
  .description('Manage and inspect runs.')
  .action(function () {
    this.showHelp();
  })
  .command('list', runsListCommand)
  .command('get', runsGetCommand)
  .command('stop', runsStopCommand);
