import { Command } from '@cliffy/command';
import { Confirm } from '@cliffy/prompt';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatResourceRelease } from '../../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../../output/spinner.js';

export const resourcesReleaseCommand = new Command()
  .name('release')
  .description('Release a resource (async, idempotent).')
  .option('-r, --resource-id <resourceId:string>', 'Resource ID to release.', {
    required: true,
  })
  .option('-y, --yes', 'Skip the confirmation prompt.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ resourceId, yes, json }) => {
    try {
      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      if (!yes) {
        if (json) {
          throw new MonidError(
            'INVALID_INPUT',
            'Cannot prompt for confirmation in --json mode. Use --yes to skip.',
            400,
          );
        }

        const confirmed = await Confirm.prompt(
          `Release resource "${resourceId}"? This may affect billing.`,
        );

        if (!confirmed) {
          console.log('Cancelled.');
          process.exit(0);
        }
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (!json) {
        startSpinner(`Releasing resource ${resourceId}...`);
      }

      const result = await api.releaseResource(resourceId);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Resource ${result.resourceId} is being released.`);
        formatResourceRelease(result);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      if (err instanceof MonidError && err.statusCode === 409) {
        handleError(
          new MonidError(
            'CONFLICT',
            err.message ||
              `Resource ${resourceId} cannot be released (it may already be released).`,
            409,
          ),
          json,
        );
      }
      handleError(err, json);
    }
  });
