import { Command } from '@cliffy/command';
import { hasKey, setActiveKeyLabel } from '../../config/store.js';
import { handleError } from '../../utils/error.js';
import { success } from '../../output/colors.js';

export const keysActivateCommand = new Command()
  .name('activate')
  .description('Set a stored API key as the active key.')
  .option('-l, --label <label:string>', 'Label of the key to activate.', {
    required: true,
  })
  .action(async ({ label }) => {
    try {
      if (!hasKey(label)) {
        throw new Error(
          `No key found with label "${label}". Run "monid keys list" to see available keys.`,
        );
      }

      setActiveKeyLabel(label);
      success(`Key "${label}" activated.`);
    } catch (err) {
      handleError(err);
    }
  });
