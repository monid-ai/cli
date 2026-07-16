import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatResourceEvents } from '../../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../../output/spinner.js';

export const resourcesEventsCommand = new Command()
  .name('events')
  .description('List a resource lifecycle event history (oldest first).')
  .option('-r, --resource-id <resourceId:string>', 'Resource ID to inspect.', {
    required: true,
  })
  .option('-l, --limit <limit:number>', 'Maximum number of events to list.')
  .option('--cursor <cursor:string>', 'Pagination cursor.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ resourceId, limit, cursor, json }) => {
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
        startSpinner(`Fetching events for ${resourceId}...`);
      }

      const data = await api.listResourceEvents(resourceId, { limit, cursor });
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Found ${data.items.length} event(s)`);
        formatResourceEvents(data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
