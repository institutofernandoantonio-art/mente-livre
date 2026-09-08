import { parseTaskPriorityCommand } from '../../src/lib/conversation/task-priority-parser.ts';

export { parseTaskPriorityCommand };

export const handlers = {
  applyTaskPriorityCommand: async () => ({ status: 'error' }),
};

export async function applyTaskPriorityCommand(...args) {
  return handlers.applyTaskPriorityCommand(...args);
}
