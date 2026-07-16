import { Command } from '@cliffy/command';
import { resourcesListCommand } from './list.js';
import { resourcesGetCommand } from './get.js';
import { resourcesReleaseCommand } from './release.js';
import { resourcesEventsCommand } from './events.js';

export const resourcesCommand = new Command()
  .name('resources')
  .description('Manage the resource lifecycle (list, inspect, release).')
  .action(function () {
    this.showHelp();
  })
  .command('list', resourcesListCommand)
  .command('get', resourcesGetCommand)
  .command('release', resourcesReleaseCommand)
  .command('events', resourcesEventsCommand);
