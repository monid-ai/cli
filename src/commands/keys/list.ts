import { Command } from '@cliffy/command';
import { getAllKeys, getActiveKeyLabel } from '../../config/store.js';
import { handleError } from '../../utils/error.js';
import { formatKeysList } from '../../output/format.js';
import { obfuscateApiKey } from '../../utils/keys.js';

export const keysListCommand = new Command()
  .name('list')
  .description('List all locally stored API keys.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ json }) => {
    try {
      const keys = getAllKeys();
      const activeLabel = getActiveKeyLabel();

      if (json) {
        const output = Object.entries(keys).map(([label, cred]) => ({
          label,
          prefix: cred.prefix,
          key: obfuscateApiKey(cred.key),
          added_at: cred.added_at,
          active: label === activeLabel,
        }));
        console.log(JSON.stringify(output, null, 2));
      } else {
        formatKeysList(keys, activeLabel);
      }
    } catch (err) {
      handleError(err, json);
    }
  });
