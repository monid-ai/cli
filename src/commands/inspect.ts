import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { formatInspectResult } from '../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../output/spinner.js';

export const inspectCommand = new Command()
  .name('inspect')
  .description('Get full details for a data endpoint.')
  .option('-p, --provider <provider:string>', 'Provider slug.', {
    required: true,
  })
  .option('-e, --endpoint <endpoint:string>', 'Endpoint name.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ provider, endpoint, json }) => {
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
        startSpinner(`Inspecting ${provider}/${endpoint}...`);
      }

      const data = await api.inspect(provider, endpoint);

      if (json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        succeedSpinner(`Fetched details about ${endpoint} from ${provider}`);
        formatInspectResult(data);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
