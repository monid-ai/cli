import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import {
  startSpinner,
  succeedSpinner,
  stopSpinner,
} from '../../output/spinner.js';

export const runsStopCommand = new Command()
  .name('stop')
  .description('Stop an in-progress run.')
  .option('-r, --run-id <runId:string>', 'Run ID to stop.', { required: true })
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ runId, json }) => {
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
        startSpinner(`Stopping run ${runId}...`);
      }

      const result = await api.stopRun(runId);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Run ${result.runId} is being stopped.`);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      if (err instanceof MonidError && err.statusCode === 409) {
        handleError(
          new MonidError(
            'CONFLICT',
            err.message ||
              `Run ${runId} cannot be stopped (it may already be finished).`,
            409,
          ),
          json,
        );
      }
      handleError(err, json);
    }
  });
