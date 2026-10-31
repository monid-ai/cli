import { Command } from '@cliffy/command';
import { generateSessionId } from '../utils/session-id.js';

export const generateSessionIdCommand = new Command()
  .name('generate_session_id')
  .description('Generate a new short session ID.')
  .option('-j, --json', 'Output as JSON.')
  .action(({ json }) => {
    const sessionId = generateSessionId();
    if (json) {
      console.log(JSON.stringify({ sessionId }, null, 2));
    } else {
      console.log(sessionId);
    }
  });
