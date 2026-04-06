import { Command } from '@cliffy/command';
import { validateApiKeyFormat, extractApiKeyPrefix, obfuscateApiKey } from '../../utils/keys.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError } from '../../utils/error.js';
import { success } from '../../output/colors.js';

export const keysAddCommand = new Command()
  .name('add')
  .description('Add an API key to the local credential store.')
  .option('-k, --key <key:string>', 'The API key string.', { required: true })
  .option('-l, --label <label:string>', 'Label for the API key.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ key, label, json }) => {
    try {
      const config = new ConfigManager();

      // Validate key format
      if (!validateApiKeyFormat(key)) {
        throw new Error(
          'Invalid API key format. Expected: monid_<stage>_<secret>',
        );
      }

      // Check label uniqueness
      if (config.hasKey(label)) {
        throw new Error(
          `A key with label "${label}" already exists. Use a different label.`,
        );
      }

      // Extract prefix and store
      const prefix = extractApiKeyPrefix(key);
      config.addKey(label, key, prefix);

      // Auto-activate if first key
      if (config.getKeyCount() === 1) {
        config.activateKey(label);
      }

      if (json) {
        console.log(JSON.stringify({}, null, 2));
      } else {
        success(`Key "${label}" added successfully (${obfuscateApiKey(key)})`);
        if (config.getKeyCount() === 1) {
          success(`Key "${label}" activated.`);
        }
      }
    } catch (err) {
      handleError(err, json);
    }
  });
