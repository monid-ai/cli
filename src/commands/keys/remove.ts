import { Command } from '@cliffy/command';
import { removeKey, hasKey } from '../../config/store.js';
import { handleError } from '../../utils/error.js';
import { success } from '../../output/colors.js';

export const keysRemoveCommand = new Command()
  .name('remove')
  .description('Remove an API key from the local credential store.')
  .option('-l, --label <label:string>', 'Label of the key to remove.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .option('--force', 'Skip confirmation prompt.')
  .action(async ({ label, json, force }) => {
    try {
      if (!hasKey(label)) {
        throw new Error(`No key found with label "${label}".`);
      }

      // TODO: Add interactive confirmation when --force is not set
      // For now, always remove (confirmation requires @cliffy/prompt)

      const removed = removeKey(label);
      if (!removed) {
        throw new Error(`Failed to remove key "${label}".`);
      }

      if (json) {
        console.log(JSON.stringify({}, null, 2));
      } else {
        success(`Key "${label}" removed.`);
      }
    } catch (err) {
      handleError(err, json);
    }
  });
