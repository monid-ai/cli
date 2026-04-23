import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatRunDetail, resolveOutput } from '../output/format.js';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  updateSpinner,
  stopSpinner,
} from '../output/spinner.js';
import { statusBadge } from '../output/colors.js';
import { pollUntilDone } from '../utils/poll.js';
import type { RunDetailResponse } from '../api/types.js';

export const runCommand = new Command()
  .name('run')
  .description('Execute a data endpoint and retrieve results.')
  .option('-p, --provider <provider:string>', 'Provider slug.', {
    required: true,
  })
  .option('-e, --endpoint <endpoint:string>', 'Endpoint name.', {
    required: true,
  })
  .option('-i, --input <input:string>', 'Body input JSON string.')
  .option('-f, --input-file <inputFile:string>', 'Read body input from a JSON file.')
  .option('--query <query:string>', 'Query parameters JSON string.')
  .option('--path <path:string>', 'Path parameters JSON string.')
  .option('-w, --wait [timeout:number]', 'Wait for completion (timeout in seconds).')
  .option('-o, --output <output:string>', 'Write output to a file.')
  .option('-j, --json', 'Output as JSON.')
  .action(async (options) => {
    const { provider, endpoint, json, wait, output } = options;
    const input = options.input as string | undefined;
    const inputFile = options.inputFile as string | undefined;
    const queryRaw = options.query as string | undefined;
    const pathRaw = options.path as string | undefined;

    try {
      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      // Parse body input
      let inputData: Record<string, unknown> | undefined;
      if (input) {
        try {
          inputData = JSON.parse(input);
        } catch {
          throw new Error('Invalid JSON input. Use -i \'{"key": "value"}\' format.');
        }
      } else if (inputFile) {
        try {
          const fileContent = readFileSync(inputFile, 'utf-8');
          inputData = JSON.parse(fileContent);
        } catch {
          throw new Error(`Failed to read or parse input file: ${inputFile}`);
        }
      }

      // Parse query params
      let queryParams: Record<string, unknown> | undefined;
      if (queryRaw) {
        try {
          queryParams = JSON.parse(queryRaw);
        } catch {
          throw new Error('Invalid JSON for --query. Use --query \'{"key": "value"}\' format.');
        }
      }

      // Parse path params
      let pathParams: Record<string, unknown> | undefined;
      if (pathRaw) {
        try {
          pathParams = JSON.parse(pathRaw);
        } catch {
          throw new Error('Invalid JSON for --path. Use --path \'{"key": "value"}\' format.');
        }
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (!json) {
        startSpinner(`Starting run: ${provider}/${endpoint}...`);
      }

      // Fire the run
      const runRes = await api.run(provider, endpoint, inputData, queryParams, pathParams);

      // Check if the run completed synchronously
      const isTerminal = runRes.status === 'COMPLETED' || runRes.status === 'FAILED';

      if (!wait && !isTerminal) {
        // Default: fire and return the run ID (only if not already complete)
        const updateInfo = await config.getUpdateInfo();
        if (json) {
          const output = updateInfo ? applyUpdateNote(runRes, updateInfo) : runRes;
          console.log(JSON.stringify(output, null, 2));
        } else {
          succeedSpinner(`Run started: ${runRes.runId}`);
          console.log(`Run ID: ${runRes.runId}`);
          console.log(`Status: ${statusBadge(runRes.status)}`);
          if (runRes.providerResponse) {
            const httpStatus = runRes.providerResponse.httpStatus;
            const statusColor = httpStatus >= 400 ? chalk.red : httpStatus >= 200 && httpStatus < 300 ? chalk.green : chalk.yellow;
            console.log(`Response: ${statusColor(String(httpStatus))}`);
          }
          console.log(`Poll with: monid runs get -r ${runRes.runId}`);
          if (updateInfo) printUpdateNotice(updateInfo);
        }
        return;
      }

      // Get the final result - either the sync response or poll for it
      let result: RunDetailResponse;
      
      if (isTerminal) {
        // Already complete - treat runRes as the full detail response
        result = runRes as RunDetailResponse;
      } else {
        // --wait mode: poll until done
        if (!json) {
          updateSpinner(`Running ${runRes.runId}...`);
        }

        const timeoutMs =
          typeof wait === 'number' ? wait * 1000 : 300_000;

        result = await pollUntilDone<RunDetailResponse>(
          () => api.getRun(runRes.runId),
          (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
          timeoutMs,
        );
      }

      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const out = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(out, null, 2));
      } else {
        if (result.status === 'COMPLETED') {
          succeedSpinner(`Run completed: ${result.runId}`);
        } else {
          failSpinner(`Run failed: ${result.runId}`);
        }
        formatRunDetail(result);
      }

      // Write output to file if requested
      if (output) {
        const outputData = resolveOutput(result);
        if (outputData) {
          writeFileSync(output, JSON.stringify(outputData, null, 2));
          if (!json) {
            console.log(`Output written to ${output}`);
          }
        }
      }

      if (!json && updateInfo) printUpdateNotice(updateInfo);
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
