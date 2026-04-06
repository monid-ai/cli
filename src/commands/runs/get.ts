import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { formatRunDetail } from '../../output/format.js';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  updateSpinner,
  stopSpinner,
} from '../../output/spinner.js';
import { pollUntilDone } from '../../utils/poll.js';
import type { RunDetailResponse } from '../../api/types.js';

export const runsGetCommand = new Command()
  .name('get')
  .description('Get the status and result of a run.')
  .option('-r, --run-id <runId:string>', 'Run ID to look up.', { required: true })
  .option('-w, --wait [timeout:number]', 'Wait for completion (timeout in seconds).')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ runId, wait, json }) => {
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
        startSpinner(`Fetching run ${runId}...`);
      }

      let result: RunDetailResponse;

      if (wait !== undefined) {
        // Poll until done
        const timeoutMs =
          typeof wait === 'number' ? wait * 1000 : 300_000;

        if (!json) {
          updateSpinner(`Waiting for run ${runId}...`);
        }

        result = await pollUntilDone<RunDetailResponse>(
          () => api.getRun(runId),
          (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
          timeoutMs,
        );
      } else {
        result = await api.getRun(runId);
      }

      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.status === 'COMPLETED') {
          succeedSpinner(`Run completed: ${result.runId}`);
        } else if (result.status === 'FAILED') {
          failSpinner(`Run failed: ${result.runId}`);
        } else {
          succeedSpinner(`Run status: ${result.status}`);
        }
        formatRunDetail(result);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
