import { Command } from '@cliffy/command';
import { VERSION } from './config/constants.js';
import { balanceCommand } from './commands/balance.js';
import { topupCommand } from './commands/topup.js';
import { keysCommand } from './commands/keys/index.js';
import { discoverCommand } from './commands/discover.js';
import { inspectCommand } from './commands/inspect.js';
import { runCommand } from './commands/run.js';
import { runsCommand } from './commands/runs/index.js';
import { resourcesCommand } from './commands/resources/index.js';
import { whoamiCommand } from './commands/whoami.js';
import { setupCommand } from './commands/setup.js';
import { generateSessionIdCommand } from './commands/generate-session-id.js';
import { feedbackCommand } from './commands/feedback.js';
import { disputeCommand } from './commands/dispute.js';

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
  .command('topup', topupCommand)
  .command('keys', keysCommand)
  .command('generate_session_id', generateSessionIdCommand)
  .command('feedback', feedbackCommand)
  .command('dispute', disputeCommand);

await cli.parse();
