import { Command } from '@cliffy/command';
import { ConfigManager } from '../../config/manager.js';
import { handleError } from '../../utils/error.js';
import { printUpdateNotice } from '../../utils/update-check.js';
import { success } from '../../output/colors.js';

export const keysActivateCommand = new Command()
  .name('activate')
  .description('Set a stored API key as the active key.')
  .option('-l, --label <label:string>', 'Label of the key to activate.', {
    required: true,
  })
  .action(async ({ label }) => {
    try {
      const config = new ConfigManager();

      if (!config.hasKey(label)) {
        throw new Error(
          `No key found with label "${label}". Run "monid keys list" to see available keys.`,
        );
      }

      config.activateKey(label);
      success(`Key "${label}" activated.`);

      const updateInfo = await config.getUpdateInfo();
      if (updateInfo) printUpdateNotice(updateInfo);
    } catch (err) {
      handleError(err);
    }
  });
