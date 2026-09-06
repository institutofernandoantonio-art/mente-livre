export const handlers = {
  isCalendarCancellationRuntimeState: () => false,
  startCalendarCancellation: async () => ({ status: 'error' }),
  handleCalendarCancellationRuntime: async () => ({ status: 'not_applicable' }),
};

export function isCalendarCancellationRuntimeState(...args) {
  return handlers.isCalendarCancellationRuntimeState(...args);
}

export async function startCalendarCancellation(...args) {
  return handlers.startCalendarCancellation(...args);
}

export async function handleCalendarCancellationRuntime(...args) {
  return handlers.handleCalendarCancellationRuntime(...args);
}
