import chalk from 'chalk';
import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatWhoami } from '../output/format.js';
import { renderTable } from '../output/table.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../output/spinner.js';

export const whoamiCommand = new Command()
  .name('whoami')
  .description('Show the authenticated user and workspace.')
  .option('--workspaces', 'List all workspaces the caller belongs to.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ workspaces, json }) => {
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
        startSpinner('Fetching identity...');
      }

      if (workspaces) {
        const data = await api.listWorkspaces();
        const updateInfo = await config.getUpdateInfo();

        if (json) {
          const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
          console.log(JSON.stringify(output, null, 2));
        } else {
          succeedSpinner(`Found ${data.workspaces.length} workspace(s)`);
          if (data.workspaces.length === 0) {
            console.log(chalk.gray('No workspaces.'));
          } else {
            renderTable(
              ['Workspace ID', 'Slug'],
              data.workspaces.map((w) => [w.workspaceId, w.slug ?? '-']),
            );
          }
          if (updateInfo) printUpdateNotice(updateInfo);
        }
        return;
      }

      const data = await api.whoami();
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner('Authenticated');
        formatWhoami(data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
