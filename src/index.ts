import { Command } from '@cliffy/command';
import { VERSION } from './config/constants.js';
import { keysCommand } from './commands/keys/index.js';
import { discoverCommand } from './commands/discover.js';
import { inspectCommand } from './commands/inspect.js';
import { runCommand } from './commands/run.js';
import { runsCommand } from './commands/runs/index.js';

const cli = new Command()
  .name('monid')
  .version(VERSION)
  .description(
    'Monid CLI — discover, inspect, and run data endpoints across the web.',
  )
  .action(function () {
    this.showHelp();
  })
  .command('discover', discoverCommand)
  .command('inspect', inspectCommand)
  .command('run', runCommand)
  .command('runs', runsCommand)
  .command('keys', keysCommand);

await cli.parse();
