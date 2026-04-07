import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatDiscoverResults } from '../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../output/spinner.js';

export const discoverCommand = new Command()
  .name('discover')
  .description('Search for data endpoints using natural language.')
  .option('-q, --query <query:string>', 'Search query.', { required: true })
  .option('-l, --limit <limit:number>', 'Maximum number of results (max 10).')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ query, limit, json }) => {
    try {
      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (!json) {
        startSpinner(`Searching for "${query}"...`);
      }

      const data = await api.discover(query, limit);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Found ${data.count} result(s)`);
        formatDiscoverResults(data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
