import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatDiscoverResults } from '../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner } from '../output/spinner.js';

/** `free, promotion,` → `['free', 'promotion']`; nothing left → undefined. */
export function cleanTags(tags: string[] | undefined): string[] | undefined {
  const out = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export const discoverCommand = new Command()
  .name('discover')
  .description('Search for data endpoints using natural language.')
  .option('-q, --query <query:string>', 'Search query.', { required: true })
  .option('-l, --limit <limit:number>', 'Maximum number of results (max 50).')
  .option('-s, --min-score <minScore:number>', 'Minimum relevance score (float, higher = more relevant filtering).')
  .option(
    '-u, --include-unavailable',
    'Include endpoints currently in outage (hidden by default, ranked last).',
  )
  .option(
    '-t, --tags <tags:string[]>',
    'Only endpoints with ANY of these tags, comma-separated (e.g. free,promotion). See `monid tags`.',
  )
  .option(
    '-x, --exclude-tags <tags:string[]>',
    'Drop endpoints with ANY of these tags, comma-separated (e.g. promotion). See `monid tags`.',
  )
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ query, limit, minScore, includeUnavailable, tags, excludeTags, json }) => {
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
        startSpinner(`Searching for "${query}"...`);
      }

      const data = await api.discover(query, limit, minScore, includeUnavailable, {
        tags: cleanTags(tags),
        excludeTags: cleanTags(excludeTags),
      });
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(data, updateInfo) : data;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Found ${data.count} result(s)`);
        formatDiscoverResults(data);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });
