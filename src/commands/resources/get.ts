import { Command } from '@cliffy/command';
import { MonidAPI } from '../../api/client.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError, MonidError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { formatResourceDetail } from '../../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../../output/spinner.js';
import type {
  ResourceExternalJoin,
  ResourceWithExternal,
} from '../../api/types.js';

export const resourcesGetCommand = new Command()
  .name('get')
  .description('Get a resource, with its live external links joined in.')
  .option('-r, --resource-id <resourceId:string>', 'Resource ID to look up.', {
    required: true,
  })
  .option('--no-external', 'Skip fetching live external link details.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ resourceId, external, json }) => {
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
        startSpinner(`Fetching resource ${resourceId}...`);
      }

      const resource = await api.getResource(resourceId);

      // Fetch each external link in parallel and join them onto the resource.
      // Per-link failures are captured so the base resource still renders.
      let externalDetails: ResourceExternalJoin[] | undefined;
      const links = resource.externalResources ?? [];
      if (external && links.length > 0) {
        externalDetails = await Promise.all(
          links.map(async (link): Promise<ResourceExternalJoin> => {
            try {
              const detail = await api.getResourceExternal(resourceId, link.kind);
              return {
                kind: link.kind,
                displayName: detail.displayName ?? link.displayName,
                label: detail.label ?? link.label,
                data: detail.data,
              };
            } catch (e) {
              return {
                kind: link.kind,
                displayName: link.displayName,
                label: link.label,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }),
        );
      }

      const result: ResourceWithExternal = { ...resource, externalDetails };
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(result, updateInfo) : result;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Resource ${resource.resourceId}`);
        formatResourceDetail(result);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
