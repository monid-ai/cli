import { Command } from '@cliffy/command';
import { Secret } from '@cliffy/prompt';
import { validateApiKeyFormat, extractApiKeyPrefix, obfuscateApiKey } from '../../utils/keys.js';
import { ConfigManager } from '../../config/manager.js';
import { handleError } from '../../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../../utils/update-check.js';
import { success } from '../../output/colors.js';

async function readKeyInteractively(json?: boolean): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) data += chunk;
    return data;
  }
  if (json) {
    throw new Error('Cannot prompt for the key in --json mode. Pass -k or pipe it on stdin.');
  }
  return await Secret.prompt('API key');
}

export const keysAddCommand = new Command()
  .name('add')
  .description('Add an API key to the local credential store.')
  .option(
    '-k, --key <key:string>',
    'The API key string. Omit to read it from stdin (piped) or a hidden prompt (terminal), keeping it out of shell history and process lists.',
  )
  .option('-l, --label <label:string>', 'Label for the API key.', {
    required: true,
  })
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ key: keyOption, label, json }) => {
    try {
      const key = (keyOption ?? (await readKeyInteractively(json))).trim();
      const config = new ConfigManager();

      // Validate key format
      if (!validateApiKeyFormat(key)) {
        throw new Error(
          'Invalid API key format. Expected: monid_<stage>_<secret>',
        );
      }

      // Check label uniqueness
      if (config.hasKey(label)) {
        throw new Error(
          `A key with label "${label}" already exists. Use a different label.`,
        );
      }

      // Extract prefix and store
      const prefix = extractApiKeyPrefix(key);
      config.addKey(label, key, prefix);

      // Auto-activate if first key
      if (config.getKeyCount() === 1) {
        config.activateKey(label);
      }

      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote({}, updateInfo) : {};
        console.log(JSON.stringify(output, null, 2));
      } else {
        success(`Key "${label}" added successfully (${obfuscateApiKey(key)})`);
        if (config.getKeyCount() === 1) {
          success(`Key "${label}" activated.`);
        }
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      handleError(err, json);
    }
  });
