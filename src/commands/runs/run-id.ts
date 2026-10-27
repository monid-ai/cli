import { MonidError } from '../../utils/error.js';

/** The run ID comes as a positional or as `-r, --run-id` — exactly one. */
export function resolveRunId(positional?: string, option?: string): string {
  if (positional && option) {
    throw new MonidError(
      'INVALID_INPUT',
      'Pass the run ID once: as an argument or with -r, not both.',
    );
  }
  const runId = positional || option;
  if (!runId) {
    throw new MonidError(
      'INVALID_INPUT',
      'A run ID is required: pass it as an argument or with -r.',
    );
  }
  return runId;
}
