import { Command } from '@cliffy/command';
import { VERSION } from './config/constants.js';
import { balanceCommand } from './commands/balance.js';
import { spendCommand } from './commands/spend.js';
import { keysCommand } from './commands/keys/index.js';
import { discoverCommand } from './commands/discover.js';
import { inspectCommand } from './commands/inspect.js';
import { runCommand } from './commands/run.js';
import { runsCommand } from './commands/runs/index.js';
import { resourcesCommand } from './commands/resources/index.js';
import { whoamiCommand } from './commands/whoami.js';
import { setupCommand } from './commands/setup.js';

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
  .command('resources', resourcesCommand)
  .command('whoami', whoamiCommand)
  .command('setup', setupCommand)
  .command('balance', balanceCommand)
  .command('spend', spendCommand)
  .command('keys', keysCommand);

await cli.parse();
