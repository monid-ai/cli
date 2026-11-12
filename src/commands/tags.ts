import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatTags } from '../output/format.js';
import { startSpinner, stopSpinner } from '../output/spinner.js';

export const tagsCommand = new Command()
  .name('tags')
  .description('List the endpoint tags and what they mean (the values `discover --tags` accepts).')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ json }) => {
    try {
      const config = new ConfigManager();
      // Public data (`GET /public/v1/tags`): no API key needed.
      const api = new MonidAPI({ apiKey: '' });

      if (!json) startSpinner('Fetching tags...');
      const data = await api.tags();
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        stopSpinner();
        formatTags(data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
