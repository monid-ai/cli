import { Command } from '@cliffy/command';
import { validateApiKeyFormat, extractApiKeyPrefix, obfuscateApiKey } from '../../utils/keys.js';
import { setKey, hasKey, getKeyCount, setActiveKeyLabel } from '../../config/store.js';
import { handleError } from '../../utils/error.js';
import { success } from '../../output/colors.js';

export const keysAddCommand = new Command()
  .name('add')
  .description('Add an API key to the local credential store.')
  .arguments('<key:string>')
  .option('-l, --label <label:string>', 'Label for the API key.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ label, json }, key) => {
    try {
      // Validate key format
      if (!validateApiKeyFormat(key)) {
        throw new Error(
          'Invalid API key format. Expected: monid_<stage>_<secret>',
        );
      }

      // Check label uniqueness
      if (hasKey(label)) {
        throw new Error(
          `A key with label "${label}" already exists. Use a different label.`,
        );
      }

      // Extract prefix and store
      const prefix = extractApiKeyPrefix(key);
      setKey(label, key, prefix);

      // Auto-activate if first key
      if (getKeyCount() === 1) {
        setActiveKeyLabel(label);
      }

      if (json) {
        console.log(JSON.stringify({}, null, 2));
      } else {
        success(`Key "${label}" added successfully (${obfuscateApiKey(key)})`);
        if (getKeyCount() === 1) {
          success(`Key "${label}" activated.`);
        }
      }
    } catch (err) {
      handleError(err, json);
    }
  });
