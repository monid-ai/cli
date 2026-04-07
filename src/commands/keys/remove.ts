import { Command } from '@cliffy/command';
import { Confirm } from '@cliffy/prompt';
import { ConfigManager } from '../../config/manager.js';
import { handleError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { success } from '../../output/colors.js';

export const keysRemoveCommand = new Command()
  .name('remove')
  .description('Remove an API key from the local credential store.')
  .option('-l, --label <label:string>', 'Label of the key to remove.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .option('-f, --force', 'Skip confirmation prompt.')
  .action(async ({ label, json, force }) => {
    try {
      const config = new ConfigManager();

      if (!config.hasKey(label)) {
        throw new Error(`No key found with label "${label}".`);
      }

      if (!force) {
        if (json) {
          throw new Error(
            'Cannot prompt for confirmation in --json mode. Use --force to skip.',
          );
        }

        const confirmed = await Confirm.prompt(
          `Remove key "${label}"?`,
        );

        if (!confirmed) {
          console.log('Cancelled.');
          process.exit(0);
        }
      }

      const removed = config.removeKey(label);
      if (!removed) {
        throw new Error(`Failed to remove key "${label}".`);
      }

      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote({}, updateInfo) : {};
        console.log(JSON.stringify(output, null, 2));
      } else {
        success(`Key "${label}" removed.`);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      handleError(err, json);
    }
  });
