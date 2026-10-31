import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import type { DisputeRequest } from '../api/types.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import {
  startSpinner,
  succeedSpinner,
  stopSpinner,
} from '../output/spinner.js';

/** Server-side limits (`@shared/models/disputes`). */
export const DISPUTE_TEXT_MAX = 4000;
export const DISPUTE_RUN_IDS_MAX = 100;
export const DISPUTE_CONTEXT_RUN_IDS_MAX = 500;
export const DISPUTE_DISCOVER_REQUESTS_MAX = 100;

export interface DisputeInput {
  runIds: string[];
  reason: string;
  userQuery: string;
  discoverQueries?: string[];
  contextRunIds?: string[];
}

/**
 * Validate the command's options and build the request body. Run IDs are
 * de-duplicated (the API rejects duplicates), and the disputed runs are
 * added to `context.runIds`, which the API defines as every run the agent
 * knows about for this intent, disputed ones included. Discover queries
 * become `{ q }` bodies, the shape `context.discoverRequests` expects.
 */
export function buildDisputeRequest(input: DisputeInput): DisputeRequest {
  const runIds = unique(input.runIds);
  const reason = requireText(input.reason, 'Reason');
  const userQuery = requireText(input.userQuery, 'User query');
  const discoverQueries = (input.discoverQueries ?? []).map((q) =>
    requireText(q, 'Discover query'),
  );
  const contextRunIds = unique([...runIds, ...(input.contextRunIds ?? [])]);

  if (runIds.length === 0) {
    throw new MonidError('INVALID_INPUT', 'At least one run ID is required.');
  }
  checkCount(runIds.length, DISPUTE_RUN_IDS_MAX, 'disputed runs');
  checkCount(contextRunIds.length, DISPUTE_CONTEXT_RUN_IDS_MAX, 'context runs');
  checkCount(discoverQueries.length, DISPUTE_DISCOVER_REQUESTS_MAX, 'discover queries');

  return {
    runIds,
    reason,
    context: {
      userQuery,
      ...(discoverQueries.length > 0 && {
        discoverRequests: discoverQueries.map((q) => ({ q })),
      }),
      runIds: contextRunIds,
    },
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MonidError('INVALID_INPUT', `${label} cannot be empty.`);
  }
  if (trimmed.length > DISPUTE_TEXT_MAX) {
    throw new MonidError(
      'INVALID_INPUT',
      `${label} is ${trimmed.length} characters; the limit is ${DISPUTE_TEXT_MAX}.`,
    );
  }
  return trimmed;
}

function checkCount(count: number, max: number, label: string): void {
  if (count > max) {
    throw new MonidError(
      'INVALID_INPUT',
      `Too many ${label}: ${count}; the limit is ${max}.`,
    );
  }
}

export const disputeCommand = new Command()
  .name('dispute')
  .description(
    'Dispute runs that returned broken or useless results, with the reason and what the user wanted.',
  )
  .option('-r, --run-id <runId:string>', 'Run to dispute. Repeat for several runs.', {
    required: true,
    collect: true,
  })
  .option('--reason <reason:string>', 'Why these runs are disputed.', {
    required: true,
  })
  .option('-u, --user-query <query:string>', "The user's intent, in their words.", {
    required: true,
  })
  .option(
    '-d, --discover-query <query:string>',
    'A query sent to "monid discover" for this intent. Repeat for several.',
    { collect: true },
  )
  .option(
    '-c, --context-run-id <runId:string>',
    'Another run made for this intent (disputed runs are included automatically). Repeat for several.',
    { collect: true },
  )
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ runId, reason, userQuery, discoverQuery, contextRunId, json }) => {
    try {
      const body = buildDisputeRequest({
        runIds: runId,
        reason,
        userQuery,
        discoverQueries: discoverQuery,
        contextRunIds: contextRunId,
      });

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
        startSpinner('Filing dispute...');
      }

      const result = await api.sendDispute(body);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(output, null, 2));
      } else {
        const runs = body.runIds.length === 1 ? '1 run' : `${body.runIds.length} runs`;
        succeedSpinner(`Dispute filed for ${runs} (ID: ${result.disputeId}).`);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      // The API answers "Run <id> not found" for a run outside the caller's
      // workspace. Any other 404 means the route itself is missing for this
      // workspace (it is behind the `monid-dispute-api` rollout flag).
      if (
        err instanceof MonidError &&
        err.statusCode === 404 &&
        !/^Run \S+ not found$/.test(err.message)
      ) {
        handleError(
          new MonidError(
            'NOT_FOUND',
            'Disputes are not available for this workspace yet.',
          ),
          json,
        );
      }
      handleError(err, json);
    }
  });
