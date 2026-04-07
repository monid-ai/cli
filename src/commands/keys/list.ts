import { Command } from '@cliffy/command';
import { ConfigManager } from '../../config/manager.js';
import { handleError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatKeysList } from '../../output/format.js';
import { obfuscateApiKey } from '../../utils/keys.js';

export const keysListCommand = new Command()
  .name('list')
  .description('List all locally stored API keys.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ json }) => {
    try {
      const config = new ConfigManager();
      const keys = config.getAllKeys();
      const activeLabel = config.getActiveKeyLabel();

      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const data = Object.entries(keys).map(([label, cred]) => ({
          label,
          prefix: cred.prefix,
          key: obfuscateApiKey(cred.key),
          added_at: cred.added_at,
          active: label === activeLabel,
        }));
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        formatKeysList(keys, activeLabel);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      handleError(err, json);
    }
  });
