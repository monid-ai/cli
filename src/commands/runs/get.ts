import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatRunDetail, writeRunOutput, writeRunOutputJson, pendingRunEnvelope, printPendingRun } from '../../output/format.js';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  updateSpinner,
  stopSpinner,
} from '../../output/spinner.js';
import { pollUntilDone, PollTimeoutError } from '../../utils/poll.js';
import { isTerminalRunStatus, type RunDetailResponse } from '../../api/types.js';
import { resolveRunId } from './run-id.js';

export const runsGetCommand = new Command()
  .name('get')
  .description('Get the status and result of a run.')
  .arguments('[runId:string]')
  .option('-r, --run-id <runId:string>', 'Run ID to look up.')
  .option('-w, --wait [timeout:number]', 'Wait for completion (timeout in seconds). Put the run ID before -w, or pass it with -r: -w takes an optional number and would swallow it.')
  .option('-o, --output <output:string>', 'Write output to a file.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ runId: runIdOption, wait, json, output }, runIdArg) => {
    let runId: string | undefined;
    try {
      const id = resolveRunId(runIdArg, runIdOption);
      runId = id;
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
      // Set when --wait ran out of time with the run still going.
      let waitedSec: number | undefined;

      if (wait !== undefined) {
        // Poll until done
        const timeoutMs =
          typeof wait === 'number' ? wait * 1000 : 300_000;

        if (!json) {
          updateSpinner(`Waiting for run ${runId}...`);
        }

        try {
          result = await pollUntilDone<RunDetailResponse>(
            () => api.getRun(id),
            (r) => isTerminalRunStatus(r.status),
            timeoutMs,
          );
        } catch (err) {
          if (!(err instanceof PollTimeoutError)) throw err;
          result = err.lastResult as RunDetailResponse;
          waitedSec = Math.round(timeoutMs / 1000);
        }
      } else {
        result = await api.getRun(id);
      }

      const updateInfo = await config.getUpdateInfo();

      if (waitedSec !== undefined) {
        if (json) {
          const pending = pendingRunEnvelope(result, waitedSec, output);
          const out = updateInfo ? applyUpdateNote(pending, updateInfo) : pending;
          console.log(JSON.stringify(out, null, 2));
        } else {
          succeedSpinner(`Run still ${result.status}: ${result.runId}`);
          printPendingRun(result, waitedSec, output);
          if (updateInfo) printUpdateNotice(updateInfo);
        }
        return;
      }

      if (json) {
        const saved = output ? await writeRunOutputJson(result, output) : result;
        const out = updateInfo ? applyUpdateNote(saved, updateInfo) : saved;
        console.log(JSON.stringify(out, null, 2));
      } else {
        if (result.status === 'COMPLETED') {
          succeedSpinner(`Run completed: ${result.runId}`);
        } else if (result.status === 'FAILED') {
          failSpinner(`Run failed: ${result.runId}`);
        } else if (result.status === 'BLOCKED') {
          failSpinner(`Run blocked: ${result.runId}`);
        } else if (result.status === 'STOPPED') {
          succeedSpinner(`Run stopped: ${result.runId}`);
        } else if (result.status === 'TIMED_OUT') {
          failSpinner(`Run timed out: ${result.runId}`);
        } else {
          succeedSpinner(`Run status: ${result.status}`);
        }
        formatRunDetail(result);
      }

      // Write output to file if requested (JSON mode wrote it above)
      if (output && !json) await writeRunOutput(result, output);

      if (!json && updateInfo) printUpdateNotice(updateInfo);
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
