import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import {
  startSpinner,
  succeedSpinner,
  stopSpinner,
} from '../output/spinner.js';

/** Server-side limit on feedback text (`FEEDBACK_TEXT_MAX`). */
export const FEEDBACK_TEXT_MAX = 4000;

export const feedbackCommand = new Command()
  .name('feedback')
  .description('Send feedback about Monid, optionally about a specific run.')
  .option('-t, --text <text:string>', 'The feedback, as free text.', {
    required: true,
  })
  .option('-r, --run-id <runId:string>', 'Run the feedback is about.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ text, runId, json }) => {
    try {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new MonidError('INVALID_INPUT', 'Feedback text cannot be empty.');
      }
      if (trimmed.length > FEEDBACK_TEXT_MAX) {
        throw new MonidError(
          'INVALID_INPUT',
          `Feedback text is ${trimmed.length} characters; the limit is ${FEEDBACK_TEXT_MAX}.`,
        );
      }

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
        startSpinner('Sending feedback...');
      }

      const result = await api.sendFeedback(trimmed, runId);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Feedback sent (ID: ${result.feedbackId}). Thank you!`);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      // A 404 with a runId is the API's "run not found" (its message says
      // so). Without one, the route itself is missing for this workspace.
      if (err instanceof MonidError && err.statusCode === 404 && !runId) {
        handleError(
          new MonidError(
            'NOT_FOUND',
            'Feedback is not available for this workspace yet.',
          ),
          json,
        );
      }
      handleError(err, json);
    }
  });
