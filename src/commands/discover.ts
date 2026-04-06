import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { getActiveKey } from '../config/store.js';
import { handleError, MonidError } from '../utils/error.js';
import { formatDiscoverResults } from '../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../output/spinner.js';

export const discoverCommand = new Command()
  .name('discover')
  .description('Search for data endpoints using natural language.')
  .arguments('<query:string>')
  .option('--limit <limit:number>', 'Maximum number of results (max 10).')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ limit, json }, query) => {
    try {
      const active = getActiveKey();
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

      if (json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        succeedSpinner(`Found ${data.count} result(s)`);
        formatDiscoverResults(data);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
